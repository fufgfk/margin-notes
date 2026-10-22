import {test} from 'node:test';
import assert from 'node:assert/strict';
import {officialZhihuUrl,parseZhihuList,parseZhihuDetail,parseZhihuComments,zhihuRequestAllowed,htmlToText} from '../src/zhihu/model';
const answer={type:'answer',id:11,question:{id:10,title:'Question'},author:{name:'Author'},voteup_count:5,content:'<p>Hello<br>World</p><pre><code>x &lt; 2</code></pre>',created_time:1791540000,updated_time:1791540060};
test('official content URLs reject non-platform navigation and canonicalize identity',()=>{
 assert.equal(officialZhihuUrl('/question/10/answer/11?utm=bad'),'https://www.zhihu.com/question/10/answer/11');
 assert.equal(officialZhihuUrl('https://zhuanlan.zhihu.com/p/12'),'https://zhuanlan.zhihu.com/p/12');
 for(const url of ['https://evil.test/question/1','https://www.zhihu.com.evil.test/question/1','http://www.zhihu.com/question/1','https://a@www.zhihu.com/question/1','https://www.zhihu.com:444/question/1','https://www.zhihu.com/api/v4/answers/1','https://www.zhihu.com/question/foo'])assert.throws(()=>officialZhihuUrl(url));
 assert.equal(zhihuRequestAllowed('https://pic1.zhimg.com/image.jpg'),true);assert.equal(zhihuRequestAllowed('https://evil.test/a'),false);
});
test('mixed recommendations and searches normalize types while filtering advertisements',()=>{
 const r=parseZhihuList({data:[{target:answer},{object:{type:'question',id:10,title:'Q'}},{target:{type:'article',id:12,title:'Article',author:{name:'A'}}},{type:'ad',target:answer},{target:{type:'zvideo',id:44}}],paging:{is_end:false}});
 assert.deepEqual(r.notes.map(n=>n.kind),['answer','question','article']);assert.equal(r.hasMore,true);assert.equal(r.notes[0].questionId,'10');
 assert.equal(parseZhihuList({data:[],paging:{is_end:true}}).hasMore,false);
});
test('detail preserves text blocks and differentiates created and edited timestamps',()=>{
 const n=parseZhihuList({data:[answer]}).notes[0];const d=parseZhihuDetail(answer,n)!;
 assert.match(d.text,/Hello\nWorld/);assert.match(d.text,/x < 2/);assert.ok(d.time);assert.notEqual(d.time,d.updatedTime);
 const locked=parseZhihuDetail({...answer,content:undefined,excerpt:'Paid preview',is_paid:true},n)!;
 assert.equal(locked.text,'Paid preview');assert.match(locked.accessNotice||'',/摘要/);
 assert.equal(parseZhihuDetail({...answer,id:99},n),undefined,'wrong detail must not contaminate active answer');
 assert.doesNotMatch(htmlToText('<script>alert(1)</script><p>Body</p><img src="secret">'),/alert|secret/);
});
test('comments normalize nested replies with independent dates and bounded pagination',()=>{
 const r=parseZhihuComments({data:[{id:1,author:{member:{name:'Root'}},content:'<p>root</p>',child_comment_count:2,child_comments:[{id:2,author:{member:{name:'Reply'}},content:'reply',created_time:1791540000}]}],paging:{is_end:false}});
 assert.equal(r.comments.length,1);assert.equal(r.comments[0].time,undefined);assert.ok(r.comments[0].replies[0].time);assert.equal(r.comments[0].hasMoreReplies,true);
 assert.equal(parseZhihuComments({data:[],paging:{is_end:true}}).hasMore,false);
});
test('schema changes cannot masquerade as a successful empty feed',()=>{
 assert.throws(()=>parseZhihuList({new_schema:{items:[]}}),/结构|识别/);
 assert.throws(()=>parseZhihuComments({new_schema:{comments:[]}}),/结构|识别/);
 const n=parseZhihuList({data:[answer]}).notes[0];assert.match(parseZhihuDetail({...answer,is_paid:true},n)?.accessNotice||'',/付费|访问/);
});
