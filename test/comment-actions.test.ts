import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'patchright-core';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReaderBrowser} from '../src/browser';
import {renderNoteDocument} from '../src/render';

test('inline actions follow their own comments even with multiline content',()=>{
  const result=renderNoteDocument({id:'n',title:'Title\nsecond line',author:'a',likes:'',url:'https://www.xiaohongshu.com/explore/n',text:'body\nbody',commentStatus:'more',comments:[
    {id:'c1',author:'a\nb',text:'one\ntwo',likes:'',replies:[],hasMoreReplies:true},
    {id:'c2',author:'c',text:'three',likes:'',replies:[],hasMoreReplies:false}
  ]});
  const lines=result.text.split('\n');
  assert.equal(result.actions.length,2);assert.equal(result.actions[0].commentId,'c1');
  assert.match(lines[result.actions[0].line],/此评论还有回复/);
  assert.ok(result.actions[1].line>lines.findIndex(l=>l.includes('three')));
});

test('DOM-only reply expansion returns new replies and leaves root pagination usable',async()=>{
  const root=await mkdtemp(join(tmpdir(),'margin-dom-reply-'));
  const reader=new ReaderBrowser(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
    const context=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    await context.route('https://**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<body><div id="detail-title">Title</div><div id="detail-desc">Body</div><div class="comments-container"><div class="comment-item" data-id="c1"><span class="name">author</span><span class="content">root</span><button class="show-more" onclick="this.insertAdjacentHTML('beforebegin','<div class=comment-item data-id=r><span class=name>reply author</span><span class=content>DOM reply</span></div>');this.remove()">展开回复</button></div><div class="comment-item" data-id="c2"><span class="name">other</span><span class="content">another root</span></div></div></body>`}));
    return context;
  });
  try {
    const note=await reader.detail({id:'a',title:'Title',author:'',likes:'',url:'https://www.xiaohongshu.com/explore/a'});
    note.comments[0].time='2026-10-09 09:00';
    const next=await reader.moreReplies(note,'c1');assert.equal(next.comments[0].time,'2026-10-09 09:00');assert.equal(next.comments[0].replies[0]?.text,'DOM reply');assert.equal(next.comments[0].hasMoreReplies,false);
    const roots=await reader.moreComments(next);assert.equal(roots.comments.length,2);assert.equal(roots.comments[0].replies[0]?.text,'DOM reply');
  }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});

test('root pagination never expands replies; reply expansion targets only the selected comment',async()=>{
  const root=await mkdtemp(join(tmpdir(),'margin-replies-'));
  const expanded:string[]=[];
  const reader=new ReaderBrowser(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
    const context=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    await context.route('https://**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.pathname.includes('/api/')) {
        const parent=u.searchParams.get('root_comment_id');if(parent)expanded.push(parent);
        const data=u.pathname.endsWith('/feed')?{items:[{id:'a',note_card:{note_id:'a',title:'Title',desc:'Body'}}]}:
          parent?{comments:[{id:'reply-'+parent,content:'Reply'}],has_more:false}:
          {comments:['c1','c2'].map(id=>({id,content:id,user_info:{nickname:id},sub_comment_has_more:true})),has_more:true};
        await route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data})});
      }else await route.fulfill({contentType:'text/html; charset=utf-8',body:`<body style="height:4000px"><div class="comments-container">${['c1','c2'].map(id=>`<div class="comment-item" data-id="${id}"><span class="name">${id}</span><span class="content">${id}</span><button class="show-more" onclick="if(event.isTrusted)fetch('/api/sns/web/v2/comment/sub/page?note_id=a&root_comment_id=${id}')">展开回复</button></div>`).join('')}</div><script>
        fetch('/api/sns/web/v1/feed');fetch('/api/sns/web/v2/comment/page?note_id=a');
        window.addEventListener('scroll',()=>fetch('/api/sns/web/v2/comment/page?note_id=a'));
        </script></body>`});
    });return context;
  });
  try {
    const first=await reader.detail({id:'a',title:'Title',author:'',likes:'',url:'https://www.xiaohongshu.com/explore/a'});
    const roots=await reader.moreComments(first);assert.equal(roots.comments.length,2);assert.deepEqual(expanded,[],'root pagination must not click any reply buttons');
    const replies=await (reader as any).moreReplies(roots,'c2');
    assert.deepEqual(expanded,['c2']);assert.equal(replies.comments.find((c:any)=>c.id==='c1').replies.length,0);
    assert.equal(replies.comments.find((c:any)=>c.id==='c2').replies[0].text,'Reply');
    await assert.rejects((reader as any).moreReplies(roots,'missing'));
    assert.deepEqual(expanded,['c2'],'unknown targets must never expand another comment');
  }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});
