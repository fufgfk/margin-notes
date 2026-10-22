import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ZhihuCapture} from '../src/zhihu/capture';
import type {NoteSummary,NoteDetail} from '../src/model';
const n:NoteSummary={id:'11',platform:'zhihu',kind:'answer',questionId:'10',url:'https://www.zhihu.com/question/10/answer/11',title:'Q',author:'',likes:''};
test('capture accepts only active content, separates root/reply pages and records restrictions',()=>{
 const c=new ZhihuCapture('detail',n);
 c.accept('https://evil.test/api/v4/answers/11',{id:11,content:'wrong'});
 c.accept('https://www.zhihu.com/api/v4/answers/99',{id:99,content:'wrong'});assert.equal(c.detail,undefined);
 c.accept('https://www.zhihu.com/api/v4/answers/11',{type:'answer',id:11,question:{id:10,title:'Q'},content:'<p>body</p>'});assert.equal((c.detail as NoteDetail|undefined)?.text,'body');
 c.accept('https://www.zhihu.com/api/v4/comment_v5/answers/99/root_comment',{data:[{id:90,content:'wrong'}]});assert.equal(c.comments.length,0);
 c.accept('https://www.zhihu.com/api/v4/comment_v5/answers/11/root_comment',{data:[{id:1,content:'root',child_comment_count:2}],paging:{is_end:true}});
 c.accept('https://www.zhihu.com/api/v4/comment_v5/comment/1/child_comment',{data:[{id:2,content:'reply'}],paging:{is_end:true}});
 assert.equal(c.comments[0].replies[0].id,'2');assert.equal(c.commentHasMore,false);assert.equal(c.comments[0].hasMoreReplies,false);
 c.accept('https://www.zhihu.com/api/v4/answers/11',{error:{code:10001,message:'secret URL token'}});assert.match(c.apiError||'',/未返回/);assert.doesNotMatch(c.apiError||'',/secret/);
});
