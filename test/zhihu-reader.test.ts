import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'patchright-core';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ZhihuReader} from '../src/zhihu/reader';
const answer=(id=11,version=1)=>({type:'answer',id,question:{id:10,title:'Q'},author:{name:'A'},content:`<p>Body ${version}</p>`,comment_count:2});
test('real Chrome fixture supports recommendations, refresh, search, answers, article and independent comment actions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'margin-zhihu-'));let navigations=0,version=1;
 const reader=new ZhihuReader(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
  const c=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
  await c.route('https://**/*',async route=>{
   const u=new URL(route.request().url());let data:any;
   if(u.pathname.startsWith('/api/')){
    if(u.pathname.endsWith('/root_comment'))data={data:[{id:u.searchParams.has('more')?3:1,content:'root',author:{member:{name:'R'}},child_comment_count:1}],paging:{is_end:u.searchParams.has('more')}};
    else if(u.pathname.endsWith('/child_comment'))data={data:[{id:2,content:'reply'}],paging:{is_end:true}};
    else if(u.pathname==='/api/v4/answers/11')data=answer(11,version);
    else if(u.pathname==='/api/v4/articles/12')data={type:'article',id:12,title:'Article',content:'<p>Article text</p>'};
    else data={data:[answer(u.searchParams.has('more')?13:11,version),{type:'question',id:10,title:'Q'},{type:'article',id:12,title:'Article'}],paging:{is_end:u.searchParams.has('more')}};
    await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});return;
   }
   navigations++;
   const detail=/\/answer\/11$/.test(u.pathname)||u.pathname==='/p/12';
   const endpoint=detail?(u.pathname==='/p/12'?'/api/v4/articles/12':'/api/v4/answers/11'):u.pathname==='/search'?'/api/v4/search_v3':u.pathname==='/question/10'?'/api/v4/questions/10/answers':'/api/v4/me/feed';
   const comments=`<button class="ContentItem-action" onclick="fetch('/api/v4/comment_v5/answers/11/root_comment');document.getElementById('more').style.display='block'">2 条评论</button><div class="Comments-container"><div class="NestComment"><div class="CommentItemV2" data-id="1"><a class="UserLink-link">R</a><div class="CommentItemV2-content">root</div></div><button onclick="fetch('/api/v4/comment_v5/comment/1/child_comment')">展开 1 条回复</button></div><button id="more" style="display:none" onclick="fetch('/api/v4/comment_v5/answers/11/root_comment?more=1')">加载更多评论</button></div>`;
   await route.fulfill({contentType:'text/html; charset=utf-8',body:`<body style="height:3000px">${detail?`<div class="${u.pathname==='/p/12'?'Post-Main':'AnswerItem'}" data-aid="11">${comments}</div>`:''}<script>fetch('https://www.zhihu.com${endpoint}');let paged=false;window.addEventListener('scroll',()=>{if(!paged&&${!detail}){paged=true;fetch('${endpoint}?more=1')}})</script></body>`});
  });return c;
 });
 try{
  const a=await reader.discover();assert.equal(a.channel.name,'首页推荐');assert.equal(a.notes.length,3);
  const more=await reader.moreDiscover();assert.equal(more.notes.length,4);assert.equal(more.hasMore,false);
  const refreshed=await reader.discover(undefined,true);assert.equal(refreshed.notes.length,3,'refresh replaces cached recommendation');
  await reader.search('coffee');const q=refreshed.notes.find(n=>n.kind==='question')!;
  const answers=await reader.answers(q);assert.ok(answers.notes.every(n=>n.kind==='answer'));const moreAnswers=await reader.moreAnswers();assert.equal(moreAnswers.notes.length,2);
  const note=refreshed.notes[0];const d=await reader.detail(note);assert.equal(d.text,'Body 1');assert.equal(d.comments.length,0);
  const roots=await reader.moreComments(note).catch(e=>{throw new Error('first comments: '+e.message);});assert.equal(roots.comments.length,1);
  const replies=await reader.moreReplies(roots,'1');assert.equal(replies.comments.length,1);assert.equal(replies.comments[0].replies[0].id,'2');
  const roots2=await reader.moreComments(note).catch(e=>{throw new Error('second comments: '+e.message);});assert.equal(roots2.comments.length,2);assert.equal(roots2.comments[0].replies[0].id,'2');assert.equal(roots2.commentHasMore,false);
  const article=await reader.detail(refreshed.notes.find(n=>n.kind==='article')!);assert.equal(article.text,'Article text');
  await reader.close();const before=navigations;version=2;assert.equal((await reader.detail(note)).text,'Body 1');assert.equal(navigations,before);assert.equal((await reader.detail(note,true)).text,'Body 2');
 }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});
test('restriction pauses only Zhihu persistently, without leaking library errors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'margin-zhihu-pause-'));let launches=0,paused=false;
 const reader=new ZhihuReader(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
  launches++;const c=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
  await c.route('https://**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<body>安全验证</body>'}));return c;
 },{paused:false,save:async value=>{paused=value;}});
 try{await assert.rejects(reader.discover(),/暂停|验证/);assert.equal(paused,true);await reader.close();await assert.rejects(reader.search('again'),/暂停/);assert.equal(launches,1);}
 finally{await reader.close();await rm(root,{recursive:true,force:true});}
});

test('DOM-only replies do not seed API state or hide subsequent root comments',async()=>{
 const root=await mkdtemp(join(tmpdir(),'margin-zhihu-dom-'));
 const reader=new ZhihuReader(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
  const c=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
  await c.route('https://**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<body><h1 class="QuestionHeader-title">Q</h1><div class="AnswerItem" data-aid="11"><div class="RichContent-inner">Body</div><div class="Comments-container"><div class="NestComment"><div class="CommentItemV2" data-id="1"><a class="UserLink-link">Root</a><div class="CommentItemV2-content">root</div></div><button onclick="this.insertAdjacentHTML('beforebegin','<div class=CommentItemV2 data-id=2><a class=UserLink-link>Reply</a><div class=CommentItemV2-content>reply</div></div>');this.remove()">展开 1 条回复</button></div><button onclick="this.insertAdjacentHTML('beforebegin','<div class=NestComment><div class=CommentItemV2 data-id=3><a class=UserLink-link>Other</a><div class=CommentItemV2-content>second root</div></div></div>');this.remove()">加载更多评论</button></div></div></body>`}));return c;
 });
 try{const note=await reader.detail({id:'11',platform:'zhihu',kind:'answer',questionId:'10',title:'Q',author:'',likes:'',url:'https://www.zhihu.com/question/10/answer/11'});const replies=await reader.moreReplies(note,'1');assert.equal(replies.comments[0].replies[0].id,'2');const roots=await reader.moreComments(replies);assert.equal(roots.comments.length,2);assert.equal(roots.comments[0].replies[0].id,'2');}
 finally{await reader.close();await rm(root,{recursive:true,force:true});}
});
test('DOM comments activate once, then page roots without toggling the initial control again',async()=>{
 const root=await mkdtemp(join(tmpdir(),'margin-zhihu-toggle-'));
 const reader=new ZhihuReader(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
  const c=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
  await c.route('https://**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<body><div class="AnswerItem" data-aid="11"><div class="RichContent-inner">Body</div><button onclick="const p=document.querySelector('.Comments-container');p.hidden=!p.hidden">2 条评论</button><div class="Comments-container" hidden><div class="CommentItemV2" data-id="1"><div class="CommentItemV2-content">first</div></div><button onclick="this.insertAdjacentHTML('beforebegin','<div class=CommentItemV2 data-id=3><div class=CommentItemV2-content>second</div></div>');this.remove()">加载更多评论</button></div></div></body>`}));return c;
 });
 try{const n=await reader.detail({id:'11',platform:'zhihu',kind:'answer',questionId:'10',title:'Q',author:'',likes:'',url:'https://www.zhihu.com/question/10/answer/11'});const first=await reader.moreComments(n);assert.equal(first.comments.length,1);const second=await reader.moreComments(first);assert.equal(second.comments.length,2);}
 finally{await reader.close();await rm(root,{recursive:true,force:true});}
});
test('duplicate reply pages produce a no-progress error instead of success',async()=>{
 const root=await mkdtemp(join(tmpdir(),'margin-zhihu-duplicate-'));
 const reader=new ZhihuReader(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
  const c=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
  await c.route('https://**/*',r=>new URL(r.request().url()).pathname.startsWith('/api/')?r.fulfill({contentType:'application/json',body:JSON.stringify({data:[{id:2,content:'reply'}],paging:{is_end:false}})}):r.fulfill({contentType:'text/html; charset=utf-8',body:`<body><div class="AnswerItem" data-aid="11"><div class="RichContent-inner">Body</div><div class="Comments-container"><div class="NestComment"><div class="CommentItemV2" data-id="1"><div class="CommentItemV2-content">root</div></div><button onclick="fetch('/api/v4/comment_v5/comment/1/child_comment')">加载更多回复</button></div></div></div></body>`}));return c;
 });
 try{const n=await reader.detail({id:'11',platform:'zhihu',kind:'answer',questionId:'10',title:'Q',author:'',likes:'',url:'https://www.zhihu.com/question/10/answer/11'});const first=await reader.moreReplies(n,'1');assert.equal(first.comments[0].replies.length,1);await assert.rejects(reader.moreReplies(first,'1'),/新增|更多回复/);}
 finally{await reader.close();await rm(root,{recursive:true,force:true});}
});
test('DOM access restrictions survive API detail fields that omit the notice',async()=>{
 const root=await mkdtemp(join(tmpdir(),'margin-zhihu-paid-'));
 const reader=new ZhihuReader(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
  const c=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
  await c.route('https://**/*',r=>new URL(r.request().url()).pathname.startsWith('/api/')?r.fulfill({contentType:'application/json',body:JSON.stringify(answer())}):r.fulfill({contentType:'text/html; charset=utf-8',body:'<body><div class="AnswerItem" data-aid="11"><div class="RichContent-inner">Preview</div><div class="PaidContent">Requires purchase</div></div><script>fetch("/api/v4/answers/11")</script></body>'}));return c;
 });
 try{const d=await reader.detail({id:'11',platform:'zhihu',kind:'answer',questionId:'10',title:'Q',author:'',likes:'',url:'https://www.zhihu.com/question/10/answer/11'});assert.match(d.accessNotice||'',/付费|摘要/);}
 finally{await reader.close();await rm(root,{recursive:true,force:true});}
});
test('unchanged list and root pages stop retries until an explicit refresh',async()=>{
 const root=await mkdtemp(join(tmpdir(),'margin-zhihu-repeat-'));let feedRequests=0,commentRequests=0;
 const reader=new ZhihuReader(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
  const c=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
  await c.route('https://**/*',r=>{const u=new URL(r.request().url());if(u.pathname.startsWith('/api/')){
   if(u.pathname.endsWith('root_comment')){commentRequests++;return r.fulfill({contentType:'application/json',body:JSON.stringify({data:[{id:1,content:'root'}],paging:{is_end:false}})});}
   feedRequests++;return r.fulfill({contentType:'application/json',body:JSON.stringify({data:[answer()],paging:{is_end:false}})});
  }return r.fulfill({contentType:'text/html; charset=utf-8',body:u.pathname==='/'?'<body style="height:3000px"><script>fetch("/api/v4/me/feed");window.addEventListener("scroll",()=>fetch("/api/v4/me/feed"))</script></body>':'<body><div class="AnswerItem" data-aid="11"><div class="RichContent-inner">Body</div><button onclick="fetch(\'/api/v4/comment_v5/answers/11/root_comment\')">加载更多评论</button></div></body>'});});return c;
 });
 try{const list=await reader.discover();await assert.rejects(reader.moreDiscover(),/新增/);const feeds=feedRequests;await assert.rejects(reader.moreDiscover(),/刷新/);assert.equal(feedRequests,feeds);
 const d=await reader.detail(list.notes[0]);const first=await reader.moreComments(d);assert.equal(first.comments.length,1);await assert.rejects(reader.moreComments(first),/新增/);const comments=commentRequests;await assert.rejects(reader.moreComments(first),/刷新/);assert.equal(commentRequests,comments);
 }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});
test('persisted pause blocks startup and failed login does not clear the pause',async()=>{
 const root=await mkdtemp(join(tmpdir(),'margin-zhihu-restore-'));let launches=0,saves=0;
 const reader=new ZhihuReader(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
  launches++;const c=await chromium.launchPersistentContext(profile,{...options,headless:true,channel:'chrome'});await c.route('https://**/*',r=>r.abort());return c;
 },{paused:true,save:async()=>{saves++;}});
 try{await assert.rejects(reader.discover(),/暂停/);assert.equal(launches,0);await assert.rejects(reader.login(),/尚未载入/);assert.equal(saves,0);await reader.close();await assert.rejects(reader.search('coffee'),/暂停/);assert.equal(launches,1);}
 finally{await reader.close();await rm(root,{recursive:true,force:true});}
});
test('hide invalidates a pending browser launch and closes the late context',async()=>{
 const root=await mkdtemp(join(tmpdir(),'margin-zhihu-cancel-'));let release!:()=>void,started!:()=>void,closed=0;
 const gate=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{started=r;});
 const reader=new ZhihuReader(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
  const c=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});c.on('close',()=>{closed++;});started();await gate;return c;
 });
 try{const pending=reader.discover();await ready;const closing=reader.close();release();await assert.rejects(pending,/收起|取消/);await closing;assert.equal(closed,1);}
 finally{release();await reader.close();await rm(root,{recursive:true,force:true});}
});

test('initial comments wait for the response instead of a transient empty placeholder',async()=>{
 const root=await mkdtemp(join(tmpdir(),'margin-zhihu-comments-loading-'));
 const reader=new ZhihuReader(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
  const c=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
  await c.route('https://**/*',async route=>{
   if(new URL(route.request().url()).pathname.includes('/root_comment')){await new Promise(r=>setTimeout(r,200));return route.fulfill({contentType:'application/json',body:JSON.stringify({data:[{id:'1',content:'loaded root'}],paging:{is_end:false}})});}
   return route.fulfill({contentType:'text/html; charset=utf-8',body:'<div class="AnswerItem" data-aid="11"><div class="RichContent-inner">Body</div><button onclick="document.querySelector(\'.Comments-container\').innerText=\'暂无评论\';fetch(\'/api/v4/comment_v5/answers/11/root_comment\')">2 条评论</button><div class="Comments-container"></div></div>'});
  });return c;
 });
 try{const n={id:'11',kind:'answer' as const,platform:'zhihu' as const,title:'Q',author:'',likes:'',url:'https://www.zhihu.com/question/10/answer/11'};await reader.detail(n);const d=await reader.moreComments(n);assert.equal(d.comments.length,1);assert.equal(d.commentHasMore,true);}finally{await reader.close();await rm(root,{recursive:true,force:true});}
});
