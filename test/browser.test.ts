import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'patchright-core';
import { readSearchDom, readDetailDom, scrollContent, findCommentReplyButton } from '../src/dom';
import { Capture, classifyPage, requestAllowed } from '../src/capture';

test('capture rejects unrelated responses, merges pages and nests subcomments',()=>{
  const c=new Capture('detail','a');
  c.accept('https://evil.test/api/sns/web/v2/comment/page?note_id=a',{data:{comments:[{id:'bad',content:'bad'}]}});
  c.accept('https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=other',{data:{comments:[{id:'wrong'}]}});
  assert.equal(c.comments.length,0);
  c.accept('https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=a',{data:{comments:[{id:'c',content:'x',sub_comment_has_more:true}],has_more:false}});
  c.accept('https://edith.xiaohongshu.com/api/sns/web/v2/comment/sub/page?note_id=a&root_comment_id=c',{data:{comments:[{id:'r',content:'y'}],has_more:false}});
  assert.equal(c.comments[0].replies[0].id,'r'); assert.equal(c.commentHasMore,false);
});
test('official media is allowed while plaintext HTTP and non-platform traffic stay blocked',()=>{
  assert.equal(requestAllowed('https://sns-webpic.xhscdn.com/a','image',false),true);
  assert.equal(requestAllowed('https://sns-webpic.xhscdn.com/a','image',true),true);
  assert.equal(requestAllowed('http://www.xiaohongshu.com/a','script',true),false);
  assert.equal(requestAllowed('https://evil.test/a','script',true),false);
});
test('access restrictions are not misrepresented as empty results',()=>{
  assert.match(classifyPage('https://www.xiaohongshu.com/website-login/error?error_code=300012','安全限制 IP存在风险')||'',/300012/);
  assert.match(classifyPage('https://www.xiaohongshu.com/explore','请完成安全验证')||'',/验证/);
  assert.equal(classifyPage('https://www.xiaohongshu.com/explore','普通笔记内容'),undefined);
});
test('real Chromium extracts text and reply hierarchy from fixture without media',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent(`<section class="note-item"><a href="https://www.xiaohongshu.com/explore/a1"></a><a class="cover" href="https://www.xiaohongshu.com/search_result/a1?xsec_token=t"></a><div class="title">咖啡</div><span class="name">甲</span><span class="count">12</span></section>`);
    const notes=await page.evaluate(readSearchDom); assert.equal(notes[0].title,'咖啡'); assert.equal(notes[0].author,'甲');assert.match(notes[0].url,/xsec_token=t/);
    await page.setContent(`<div id="detail-title">标题</div><div id="detail-desc">正文<br>第二行</div><div class="author-container"><span class="username">作者</span></div><div class="note-scroller" style="height:100px;overflow:auto"><div style="height:1200px">内容</div></div><div class="comments-container"><div class="comment-item" data-id="c1"><span class="name">乙</span><div class="content">主评论</div><div class="reply-container"><div class="comment-item" data-id="c2"><span class="name">丙</span><div class="content">回复</div></div></div><button class="show-more">展开 2 条回复</button></div></div>`);
    const detail=await page.evaluate(readDetailDom);
    assert.equal(detail.title,'标题'); assert.match(detail.text,/正文\n第二行/); assert.equal(detail.comments.length,1); assert.equal(detail.comments[0].replies[0].author,'丙');
    const button=await page.evaluate(findCommentReplyButton,{id:"c1",text:"主评论",author:"乙"});
    assert.ok(button);await page.locator(button).click();
    await page.evaluate(scrollContent,false);
    assert.ok(await page.locator('.note-scroller').evaluate(e=>e.scrollTop>0));
    await page.locator('.note-scroller').evaluate(e=>{e.scrollTop=0;});
    await page.evaluate(scrollContent,true);
    assert.ok(await page.locator('.note-scroller').evaluate(e=>e.scrollTop+e.clientHeight>=e.scrollHeight),'comment pagination must reach the loading boundary');
  } finally { await browser.close(); }
});

test('search captures current official so.xiaohongshu.com v2 endpoint',()=>{
  const capture=new Capture('search');
  capture.accept('https://so.xiaohongshu.com/api/sns/web/v2/search/notes',{success:true,data:{items:[{id:'a',xsec_token:'TOKEN',note_card:{title:'文字'}}],has_more:true}});
  assert.equal(capture.notes.length,1);assert.match(capture.notes[0].url,/xsec_token=TOKEN/);
});

test('official sibling reply containers stay attached to their root and expand only that root',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent(`<div class="comments-container">${['a','b'].map(id=>`<div class="parent-comment"><div class="comment-item" id="comment-${id}"><span class="name">same author</span><div class="content">same text</div></div><div class="reply-container"><div class="list-container"><div class="comment-item" id="comment-r${id}"><span class="name">reply author</span><div class="content">reply</div></div></div><div class="show-more" onclick="document.body.dataset.clicked='${id}'">展开 3 条回复</div></div></div>`).join('')}</div>`);
    const detail=await page.evaluate(readDetailDom);
    assert.equal(detail.comments.length,2,'sibling replies must not become root comments');
    assert.deepEqual(detail.comments.map(c=>c.id),['a','b']);assert.equal(detail.comments[1].replies[0].id,'rb');assert.equal(detail.comments[1].hasMoreReplies,true);
    const button=await page.evaluate(findCommentReplyButton,{id:'b',text:'same text',author:'same author'});
    assert.ok(button);await page.locator(button).click();
    assert.equal(await page.locator('body').getAttribute('data-clicked'),'b','ID selects correctly even when text and author are duplicated');
  }finally{await browser.close();}
});

test('DOM timestamps stay attached to their own post, root comment and reply',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<div class="note-container"><div id="detail-title">Title</div><div class="bottom-container"><span class="date">2026-10-09</span></div><div class="comments-container"><div class="comment-item" data-id="root"><span class="name">Root</span><span class="content">Text</span><div class="comment-item" data-id="reply"><span class="name">Reply</span><span class="content">Reply text</span><span class="date">昨天 12:00</span></div></div><div class="comment-item" data-id="other"><span class="name">Other</span><span class="content">Other text</span><span class="date">10分钟前</span></div></div></div>');
    const detail=await page.evaluate(readDetailDom);
    assert.equal(detail.time,'2026-10-09');
    assert.equal(detail.comments[0].time,undefined,'root must not inherit reply time');
    assert.equal(detail.comments[0].replies[0].time,'昨天 12:00');
    assert.equal(detail.comments[1].time,'10分钟前');
  }finally{await browser.close();}
});
