import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'patchright-core';
import {readZhihuListDom,readZhihuDetailDom,findZhihuReplyButton,findZhihuCommentControl} from '../src/zhihu/dom';
test('DOM reads mixed types and expands only the selected comment, without inheriting reply time',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{
 const p=await b.newPage();await p.goto('about:blank');
 await p.setContent('<div class="TopstoryItem"><a href="https://www.zhihu.com/question/10/answer/11">Answer title</a><span class="AuthorInfo-name">Author</span></div><div class="TopstoryItem"><a href="https://zhuanlan.zhihu.com/p/12">Article</a></div>');
 const list=await readZhihuListDom(p);assert.deepEqual(list.notes.map(n=>n.kind),['answer','article']);
 await p.setContent(`<div class="QuestionHeader-title">Q</div><div class="AnswerItem" data-aid="11"><div class="AuthorInfo-name">A</div><div class="RichContent-inner">Text<br>Next<pre>x &lt; 2</pre></div><div class="ContentItem-time"><a>发布于 2026-10-10 08:00</a></div></div><div class="NestComment"><div class="CommentItemV2" data-id="1"><a class="UserLink-link">Root</a><div class="CommentItemV2-content">Root text</div></div><div class="CommentItemV2" data-id="2"><a class="UserLink-link">Reply</a><div class="CommentItemV2-content">Reply text</div><span class="CommentItemV2-time">今天</span></div><button onclick="document.body.dataset.clicked='1'">展开 3 条回复</button></div><div class="NestComment"><div class="CommentItemV2" data-id="3"><a class="UserLink-link">Other</a><div class="CommentItemV2-content">Other text</div></div><button onclick="document.body.dataset.clicked='3'">展开 2 条回复</button></div>`);
 const detail=await readZhihuDetailDom(p,{id:'11',title:'Q',author:'',likes:'',platform:'zhihu',kind:'answer',questionId:'10',url:'https://www.zhihu.com/question/10/answer/11'});
 assert.ok(detail);assert.match(detail.text,/Text\nNext/);assert.match(detail.text,/x < 2/);assert.equal(detail.comments.length,2);assert.equal(detail.comments[0].time,undefined);assert.equal(detail.comments[0].replies[0].time,'今天');
 const selector=await findZhihuReplyButton(p,detail.comments[1]);assert.ok(selector);await p.locator(selector).click();assert.equal(await p.locator('body').getAttribute('data-clicked'),'3');
 }finally{await b.close();}
});
test('DOM rejects explicit wrong answer IDs and excludes another answer comments',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{
 const p=await b.newPage();const n={id:'11',platform:'zhihu' as const,kind:'answer' as const,questionId:'10',title:'Q',author:'',likes:'',url:'https://www.zhihu.com/question/10/answer/11'};
 await p.setContent('<div class="AnswerItem" data-aid="22"><div class="RichContent-inner">Wrong body</div></div>');assert.equal(await readZhihuDetailDom(p,n),undefined);
 await p.setContent('<div class="AnswerItem" data-aid="11"><div class="RichContent-inner">Right body</div></div><div class="AnswerItem" data-aid="22"><div class="Comments-container"><div class="CommentItemV2" data-id="1"><div class="CommentItemV2-content">Other answer comment</div></div></div></div>');
 const d=await readZhihuDetailDom(p,n);assert.ok(d);assert.equal(d.comments.length,0);
 }finally{await b.close();}
});

test('root pagination control belongs to the selected answer',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{
 const p=await b.newPage();await p.setContent('<div class="AnswerItem" data-aid="22"><button onclick="document.body.dataset.clicked=22">加载更多评论</button></div><div class="AnswerItem" data-aid="11"><button onclick="document.body.dataset.clicked=11">加载更多评论</button></div>');
 const selector=await findZhihuCommentControl(p,{id:'11',kind:'answer',platform:'zhihu',url:'https://www.zhihu.com/question/10/answer/11',title:'Q',author:'',likes:''},'more');assert.ok(selector);await p.locator(selector).click();assert.equal(await p.locator('body').getAttribute('data-clicked'),'11');
 }finally{await b.close();}
});

test('comment entry ignores invisible icon spacer and keeps exact answer ownership',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{
 const p=await b.newPage();await p.setContent('<div class="AnswerItem"><meta itemprop="url" content="https://www.zhihu.com/question/10/answer/22"><button onclick="document.body.dataset.clicked=22"><span>\u200b</span><svg></svg>23 条评论</button></div><div class="AnswerItem"><meta itemprop="url" content="https://www.zhihu.com/question/10/answer/11"><button onclick="document.body.dataset.clicked=11"><span>\u200b</span><svg></svg>118 条评论</button></div>');
 const selector=await findZhihuCommentControl(p,{id:'11',kind:'answer',platform:'zhihu',url:'https://www.zhihu.com/question/10/answer/11',title:'Q',author:'',likes:''},'initial');
 assert.ok(selector,'visible comment entry should survive the icon spacer');await p.locator(selector).click();assert.equal(await p.locator('body').getAttribute('data-clicked'),'11');
 }finally{await b.close();}
});

test('answer comments never activate the question header comment button',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{
 const p=await b.newPage();await p.setContent('<div class="QuestionHeader"><button onclick="document.body.dataset.clicked=0">43 条评论</button></div><div class="AnswerItem"><meta itemprop="url" content="https://www.zhihu.com/question/10/answer/11"><button onclick="document.body.dataset.clicked=11">118 条评论</button></div>');
 const selector=await findZhihuCommentControl(p,{id:'11',kind:'answer',platform:'zhihu',url:'https://www.zhihu.com/question/10/answer/11',title:'Q',author:'',likes:''},'initial');assert.ok(selector);await p.locator(selector).click();assert.equal(await p.locator('body').getAttribute('data-clicked'),'11');
 }finally{await b.close();}
});
