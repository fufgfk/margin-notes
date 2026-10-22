import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'patchright-core';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReaderBrowser} from '../src/browser';

test('body is returned before scrolling for comments, which remain loadable',async()=>{
  const root=await mkdtemp(join(tmpdir(),'margin-speed-'));
  let scrolled=false;
  const reader=new ReaderBrowser(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
    const context=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    await context.exposeBinding('recordScroll',()=>{scrolled=true;});
    await context.route('https://**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname.includes('/api/')) {
        const second=url.searchParams.has('cursor');
        if(url.pathname.includes('/comment/'))await new Promise(resolve=>setTimeout(resolve,second?650:400));
        const data=url.pathname.endsWith('/feed')?{items:[{id:'a',note_card:{note_id:'a',title:'Title',desc:'Body'}}]}:{comments:[{id:second?'c2':'c',content:'Comment'}],has_more:false};
        await route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data})});
      }else await route.fulfill({contentType:'text/html; charset=utf-8',body:`<body style="height:4000px"><script>
        fetch('/api/sns/web/v1/feed');
        window.addEventListener('scroll',()=>{window.recordScroll();fetch('/api/sns/web/v1/feed');fetch('/api/sns/web/v2/comment/page?note_id=a');fetch('/api/sns/web/v2/comment/page?note_id=a&cursor=2');});
        </script></body>`});
    });return context;
  });
  try {
    const started=performance.now();
    const note=await reader.detail({id:'a',title:'Title',author:'',likes:'',url:'https://www.xiaohongshu.com/explore/a'});
    console.log('Fixture cold body ms:',Math.round(performance.now()-started));
    assert.equal(note.text,'Body');assert.equal(scrolled,false,'body must not wait for comment scrolling');
    const comments=await reader.moreComments(note);assert.equal(comments.comments[0]?.text,'Comment');assert.equal(comments.comments.length,2,'wait for both comment requests, not just the fastest response');
  }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});
