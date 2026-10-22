import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'patchright-core';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReaderBrowser} from '../src/browser';
import type {BrowserContext} from 'patchright-core';

// Requests are fulfilled locally before leaving Chrome; no account or live site is used.
test('cached notes and searches survive hide; refreshing explicitly fetches new content',async()=>{
  const root=await mkdtemp(join(tmpdir(),'margin-cache-'));
  let navigations=0,version=1;
  const reader=new ReaderBrowser(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
    const context=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    await context.route('https://**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname.includes('/api/')) {
        const data=url.pathname.endsWith('/feed')?{items:[{id:'a',note_card:{note_id:'a',title:'Title',time:Date.UTC(2026,9,9,0,30),desc:'Body '+version}}]}:{items:[{id:'a',note_card:{title:'Title'}}],has_more:false};
        await route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data})});
      }else{
        navigations++;
        await route.fulfill({contentType:'text/html',body:`<body><script>fetch('/api/sns/web/v1/${url.pathname.startsWith('/explore/')?'feed':'search/notes'}')</script></body>`});
      }
    });return context;
  });
  try {
    const search=await reader.search('coffee');
    const first=await reader.detail(search.notes[0]);assert.equal(first.text,'Body 1');assert.equal(first.time,'2026-10-09 08:30');
    first.text='Caller mutation';
    await reader.close();version=2;
    assert.equal((await reader.detail(search.notes[0])).text,'Body 1');
    await reader.search('coffee');assert.equal(navigations,2,'cached reads must not relaunch/navigate');
    // Optional refresh argument is the new public contract; this deliberately fails before implementation.
    const refreshed=await (reader.detail as (note:typeof search.notes[0],refresh?:boolean)=>ReturnType<ReaderBrowser['detail']>)(search.notes[0],true);
    assert.equal(refreshed.text,'Body 2');assert.equal(navigations,3);
    await reader.clear();await reader.search('coffee');assert.equal(navigations,4,'clearing the session must clear caches');
  }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});

test('a restriction closes the browser and blocks subsequent reads until explicit login',async()=>{
  const root=await mkdtemp(join(tmpdir(),'margin-stop-'));
  let launches=0,closed=0;
  const reader=new ReaderBrowser(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
    launches++;
    const context=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    context.on('close',()=>{closed++;});
    await context.route('https://**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<body>IP 存在风险</body>'}));
    return context;
  });
  try {
    await assert.rejects(reader.search('coffee'),/风险/);
    assert.equal(closed,1,'a restricted browser must be closed');
    await assert.rejects(reader.search('tea'),/暂停/);
    await reader.close();
    await assert.rejects(reader.search('tea'),/暂停/);
    assert.equal(launches,1,'hide or another search must not silently retry');
    await reader.login();assert.equal(launches,2,'only explicit login reopens a restricted session');
  }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});

test('headed reading minimizes its own window and keeps rendered DOM readable',async()=>{
  const root=await mkdtemp(join(tmpdir(),'margin-window-'));
  let context:BrowserContext|undefined;
  const reader=new ReaderBrowser(join(root,'profile'),()=>({headless:false,backgroundWindow:true}),async(profile,options)=>{
    context=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    await context.route('https://**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<body><div id="detail-title">Title</div><div id="detail-desc">Background body</div><div class="comments-container"><div class="comment-item" data-id="c"><span class="name">author</span><span class="content">root</span><button class="show-more" onclick="if(event.isTrusted){this.insertAdjacentHTML('beforebegin','<div class=comment-item data-id=r><span class=name>reply</span><span class=content>Background reply</span></div>');this.remove()}">展开回复</button></div></div></body>`}));
    return context;
  });
  try {
    const note=await reader.detail({id:'a',title:'Title',author:'',likes:'',url:'https://www.xiaohongshu.com/explore/a'});
    assert.equal(note.text,'Background body');
    const expanded=await reader.moreReplies(note,'c');assert.equal(expanded.comments[0].replies[0]?.text,'Background reply');
    assert.ok(context);const page=context.pages().at(-1)!;
    const session=await context.newCDPSession(page);
    try{const {bounds}=await session.send('Browser.getWindowForTarget');assert.equal(bounds.windowState,'minimized');}finally{await session.detach();}
  }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});

test('a late API denial stops background access while cached text remains available',async()=>{
  const root=await mkdtemp(join(tmpdir(),'margin-late-stop-'));
  let closed=false;
  const reader=new ReaderBrowser(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
    const context=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    context.on('close',()=>{closed=true;});
    await context.route('https://**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname.endsWith('/feed'))await route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data:{items:[{id:'a',note_card:{note_id:'a',title:'Title',desc:'Cached body'}}]}})});
      else if(url.pathname.includes('/comment/')){await new Promise(r=>setTimeout(r,400));await route.fulfill({status:429,contentType:'application/json',body:'{}'}).catch(()=>undefined);}
      else await route.fulfill({contentType:'text/html',body:`<body><script>fetch('/api/sns/web/v1/feed');fetch('/api/sns/web/v2/comment/page?note_id=a')</script></body>`});
    });return context;
  });
  try {
    const summary={id:'a',title:'Title',author:'',likes:'',url:'https://www.xiaohongshu.com/explore/a'};
    assert.equal((await reader.detail(summary)).text,'Cached body');
    for(let i=0;i<30&&!closed;i++)await new Promise(r=>setTimeout(r,50));
    assert.equal(closed,true,'late website responses must stop the session without another user action');
    assert.equal((await reader.detail(summary)).text,'Cached body');
    await assert.rejects(reader.search('coffee'),/暂停/);
  }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});

test('a minimization failure closes the context before allowing another attempt',async()=>{
  const root=await mkdtemp(join(tmpdir(),'margin-window-fail-'));
  let closed=0;
  const reader=new ReaderBrowser(join(root,'profile'),()=>({headless:false}),async(profile,options)=>{
    const context=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    context.on('close',()=>closed++);
    context.newCDPSession=async()=>{throw new Error('CDP unavailable');};
    return context;
  });
  try {
    await assert.rejects(reader.search('coffee'),/最小化/);
    assert.equal(closed,1,'failed setup must not leave a foreground browser running');
  }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});

test('reopening search pagination retains cached pages; explicit refresh replaces them',async()=>{
  const root=await mkdtemp(join(tmpdir(),'margin-search-restore-'));
  let first=true;
  const reader=new ReaderBrowser(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
    const context=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    await context.route('https://**/*',async route=>{
      if(new URL(route.request().url()).pathname.includes('/api/')){
        const ids=first?['a','b']:['a'];first=false;
        await route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data:{items:ids.map(id=>({id,note_card:{title:id}})),has_more:true}})});
      }else await route.fulfill({contentType:'text/html',body:"<body><script>fetch('/api/sns/web/v1/search/notes')</script></body>"});
    });return context;
  });
  try {
    assert.equal((await reader.search('coffee')).notes.length,2);
    await reader.close();
    assert.deepEqual((await reader.moreSearch()).notes.map(n=>n.id),['a','b']);
    assert.equal((await reader.search('coffee')).notes.length,2);
    assert.deepEqual((await reader.search('coffee',true)).notes.map(n=>n.id),['a']);
  }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});

test('failed refresh preserves the last successful note for offline reading',async()=>{
  const root=await mkdtemp(join(tmpdir(),'margin-refresh-fail-'));
  let denied=false;
  const reader=new ReaderBrowser(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
    const context=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    await context.route('https://**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:denied?'<body>IP 存在风险</body>':'<body><div id="detail-title">Title</div><div id="detail-desc">Saved body</div></body>'}));
    return context;
  });
  try {
    const note={id:'a',title:'Title',author:'',likes:'',url:'https://www.xiaohongshu.com/explore/a'};
    assert.equal((await reader.detail(note)).text,'Saved body');denied=true;
    await assert.rejects(reader.detail(note,true),/暂停/);
    assert.equal((await reader.detail(note)).text,'Saved body');
  }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});

test('opening and refreshing notes never restores the minimized reading window',async()=>{
  const root=await mkdtemp(join(tmpdir(),'margin-no-popup-'));
  const states:string[]=[];
  const checks:Promise<void>[]=[];
  const reader=new ReaderBrowser(join(root,'profile'),()=>({headless:false,backgroundWindow:true}),async(profile,options)=>{
    const context=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    context.on('page',page=>{
      checks.push((async()=>{
        const session=await context.newCDPSession(page);
        try{const {bounds}=await session.send('Browser.getWindowForTarget');states.push(bounds.windowState!);}finally{await session.detach();}
      })());
    });
    await context.route('https://**/*',route=>route.fulfill({contentType:'text/html',body:'<body><div id="detail-title">Title</div><div id="detail-desc">Body</div></body>'}));
    return context;
  });
  try{
    const note={id:'a',title:'Title',author:'',likes:'',url:'https://www.xiaohongshu.com/explore/a'};
    await reader.detail(note);await reader.detail(note,true);
    await reader.detail({...note,id:'b',url:'https://www.xiaohongshu.com/explore/b'});
    await Promise.all(checks);
    assert.equal(states.length,1);
    assert.deepEqual(states,['minimized'],'new reading tabs must be created in background, before any corrective minimization');
  }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});

test('only the newest queued read navigates after the active read finishes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'margin-latest-'));const seen:string[]=[];
  let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve),firstStarted=new Promise<void>(resolve=>started=resolve);
  const reader=new ReaderBrowser(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
    const context=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    await context.route('https://**/*',async route=>{
      const id=new URL(route.request().url()).pathname.split('/').at(-1)!;seen.push(id);
      if(id==='a'){started();await gate;}
      await route.fulfill({contentType:'text/html',body:`<body><div id="detail-title">${id}</div><div id="detail-desc">Body ${id}</div></body>`});
    });return context;
  });
  const note=(id:string)=>({id,title:id,author:'',likes:'',url:'https://www.xiaohongshu.com/explore/'+id});
  try{
    const first=reader.detail(note('a'));await firstStarted;
    const skipped=reader.detail(note('b'));const rejected=assert.rejects(skipped,/取消/);
    const last=reader.detail(note('c'));release();await first;await rejected;
    assert.equal((await last).text,'Body c');assert.deepEqual(seen,['a','c']);
  }finally{release();await reader.close();await rm(root,{recursive:true,force:true});}
});

test('note refreshes reuse a page and retired responses cannot pause the next note',async()=>{
  const root=await mkdtemp(join(tmpdir(),'margin-reuse-'));let pages=0;
  const reader=new ReaderBrowser(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
    const context=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    context.on('page',()=>pages++);
    await context.route('https://**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname.includes('/comment/')){await new Promise(r=>setTimeout(r,700));await route.fulfill({status:429,contentType:'application/json',body:'{}'}).catch(()=>undefined);}
      else await route.fulfill({contentType:'text/html',body:`<body><div id="detail-title">Title</div><div id="detail-desc">${url.pathname}</div>${url.pathname.endsWith('/a')?"<script>fetch('/api/sns/web/v2/comment/page?note_id=a')</script>":''}</body>`});
    });return context;
  });
  const note=(id:string)=>({id,title:id,author:'',likes:'',url:'https://www.xiaohongshu.com/explore/'+id});
  try{
    await reader.detail(note('a'));await reader.detail(note('b'));await reader.detail(note('b'),true);
    assert.equal(pages,1,'detail reading should reuse one tab');
    await new Promise(r=>setTimeout(r,900));
    assert.equal((await reader.detail(note('c'))).text,'/explore/c');
  }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});

test('restriction pause survives a new reader; only explicit login clears the stored flag',async()=>{
  const root=await mkdtemp(join(tmpdir(),'margin-persist-stop-'));let paused=false,launches=0;
  const launch=async(profile:string,options:Parameters<typeof chromium.launchPersistentContext>[1])=>{
    launches++;if(launches===2)throw new Error('Fixture launch failure');
    const context=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    await context.route('https://**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<body>IP 存在风险</body>'}));return context;
  };
  const store=()=>({paused,save:async(value:boolean)=>{paused=value;}});
  const make=()=>new ReaderBrowser(join(root,'profile'),()=>({headless:true}),launch,store());
  let reader=make();
  try{
    await assert.rejects(reader.search('a'),/暂停/);assert.equal(paused,true);
    await reader.close();reader=make();await assert.rejects(reader.search('b'),/暂停/);assert.equal(launches,1);
    await reader.clear();await assert.rejects(reader.search('c'),/暂停/);
    await assert.rejects(reader.login(),/暂停/);assert.equal(paused,true,'failed login must retain the stop flag');
    await reader.login();assert.equal(paused,false);assert.equal(launches,3);
  }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});

test('retiring a page invalidates pending response bodies before background setup awaits',async()=>{
  const {EventEmitter}=await import('node:events');
  let closed=0,releaseBody!:(body:Buffer)=>void,releaseBackground!:()=>void,setupStarted!:()=>void;
  const body=new Promise<Buffer>(resolve=>releaseBody=resolve);
  const background=new Promise<void>(resolve=>releaseBackground=resolve);
  const started=new Promise<void>(resolve=>setupStarted=resolve);
  const page=Object.assign(new EventEmitter(),{isClosed:()=>false,context:()=>context});
  const context={newPage:async()=>page,close:async()=>{closed++;}};
  const reader=new ReaderBrowser('/unused-local-fixture',()=>({headless:true}));
  const internal=reader as any;
  internal.context=context;internal.ensure=async()=>context;
  let backgrounds=0;
  internal.background=async()=>{if(++backgrounds===2){setupStarted();await background;}};
  const old=await internal.observe('detail','a');
  const request={url:()=> 'https://edith.xiaohongshu.com/api/sns/web/v1/feed',postDataJSON:()=>({})};
  page.emit('request',request);
  page.emit('response',{status:()=>200,url:request.url,request:()=>request,headers:()=>({'content-type':'application/json'}),body:()=>body});
  const replacement=internal.observe('detail','b',old);await started;
  releaseBody(Buffer.from(JSON.stringify({success:false,code:300012,msg:'fixture denial'})));
  try{
    await Promise.all([...old.pending]);
    assert.equal(closed,0,'retired response must not close the context during awaited setup');
  }finally{releaseBackground();await replacement;await reader.close();}
});
