import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'patchright-core';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReaderBrowser } from '../src/browser';

test('browser session observes real page responses, isolates profile, reads detail and clears',async()=>{
  const root=await mkdtemp(join(tmpdir(),'margin-test-'));
  const reader=new ReaderBrowser(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
    const ctx=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    await ctx.route('https://**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.hostname==='edith.xiaohongshu.com') {
        const data=u.pathname.endsWith('/search/notes')?{items:[{id:'a',note_card:{title:'测试笔记',user:{nickname:'甲'}}}],has_more:false}:u.pathname.endsWith('/feed')?{items:[{id:'a',note_card:{note_id:'a',title:'测试笔记',desc:'实际网页响应正文',user:{nickname:'甲'}}}]}:{comments:[{id:'c',content:'实际评论',user_info:{nickname:'乙'}}],has_more:false};
        await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({success:true,data})});
      } else {
        const detail=u.pathname.startsWith('/explore/');
        const paths=detail?['/api/sns/web/v1/feed','/api/sns/web/v2/comment/page?note_id=a']:['/api/sns/web/v1/search/notes'];
        await route.fulfill({contentType:'text/html',body:`<html><body><section class="note-item"><a href="https://www.xiaohongshu.com/explore/a?xsec_token=DOM_TOKEN"></a><div class="title">测试笔记</div></section>阅读测试<script>${paths.map(p=>`fetch('https://edith.xiaohongshu.com${p}')`).join(';')}</script></body></html>`});
      }
    });
    return ctx;
  });
  try {
    const search=await reader.search('测试'); assert.equal(search.notes[0].title,'测试笔记'); assert.equal(search.hasMore,false);assert.match(search.notes[0].url,/xsec_token=DOM_TOKEN/);
    const detail=await reader.detail(search.notes[0]); assert.equal(detail.text,'实际网页响应正文'); assert.equal(detail.comments[0].text,'实际评论');
    await assert.rejects(reader.detail({...search.notes[0],id:'missing',url:'https://www.xiaohongshu.com/explore/missing'}));
    const resumed=await reader.moreComments();assert.equal(resumed.id,'a','failed navigation must keep previous active note');
    if(process.platform!=='win32') assert.equal((await stat(join(root,'profile'))).mode&0o777,0o700);
    await reader.clear(); await assert.rejects(stat(join(root,'profile')));
  } finally {await reader.close(); await rm(root,{recursive:true,force:true});}
});
