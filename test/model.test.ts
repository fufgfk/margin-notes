import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, officialNoteUrl, parseSearch, parseDetail, parseComments, mergeById, allowedHost } from '../src/model';
import { renderNote } from '../src/render';

test('only official HTTPS note links are accepted and token stays on official origin', () => {
  assert.equal(officialNoteUrl('/explore/abc123?xsec_token=token&xsec_source=pc_search'), 'https://www.xiaohongshu.com/explore/abc123?xsec_token=token&xsec_source=pc_search');
  for (const url of ['https://evil.test/explore/abc','http://www.xiaohongshu.com/explore/a','https://www.xiaohongshu.com.evil.test/explore/a','javascript:alert(1)','https://user:pass@www.xiaohongshu.com/explore/a','https://www.xiaohongshu.com/logout']) assert.throws(() => officialNoteUrl(url));
  assert.equal(allowedHost('evilxiaohongshu.com'), false);
  assert.equal(allowedHost('edith.xiaohongshu.com'), true);
});

test('text removes bidi and terminal controls while preserving Chinese and paragraphs', () => {
  assert.equal(cleanText('你好\u202Eabc\u0000\r\n第二行'), '你好abc\n第二行');
});

test('search parser skips ads/non-notes, normalizes fields and keeps official tokens', () => {
  const notes = parseSearch({data:{items:[{id:'a1',xsec_token:'t',note_card:{display_title:'咖啡',user:{nickname:'作者'},interact_info:{liked_count:'23'}}},{id:'ad',model_type:'hot_query',title:'广告'}],has_more:true}});
  assert.equal(notes.length, 1); assert.equal(notes[0].title,'咖啡'); assert.equal(notes[0].author,'作者');
  assert.match(notes[0].url,/xsec_token=t/);
});

test('detail uses matching note and comments normalize nested replies', () => {
  const note = parseDetail({data:{items:[{id:'a1',note_card:{note_id:'a1',title:'标题',desc:'正文',user:{nickname:'作者'}}}]}}, 'a1');
  assert.equal(note?.text,'正文');
  assert.equal(parseDetail({data:{items:[{id:'other',note_card:{title:'错误'}}]}}, 'a1'), undefined);
  const comments = parseComments({data:{comments:[{id:'c1',content:'主评论',user_info:{nickname:'甲'},sub_comments:[{id:'c2',content:'回复',user_info:{nickname:'乙'}}],sub_comment_has_more:true}]}});
  assert.equal(comments[0].replies[0].text,'回复'); assert.equal(comments[0].hasMoreReplies,true);
});

test('comment merging deduplicates while preserving previously loaded replies', () => {
  const old = parseComments({data:{comments:[{id:'c',content:'x',sub_comments:[{id:'r',content:'回复'}]}]}});
  const next = parseComments({data:{comments:[{id:'c',content:'x',sub_comments:[{id:'r2',content:'新回复'}]}]}});
  const merged=mergeById(old,next);
  assert.deepEqual(merged[0].replies.map(r=>r.id),['r','r2']);
});

test('render text does not emit executable links or tokens and includes nested comments', () => {
  const text=renderNote({id:'a',title:'hello',author:'甲',url:'https://www.xiaohongshu.com/explore/a?xsec_token=SECRET',likes:'1',text:'<script>alert(1)</script>',comments:[{id:'c',author:'乙',text:'好',likes:'2',replies:[{id:'r',author:'丙',text:'是',likes:'0',replies:[],hasMoreReplies:false}],hasMoreReplies:false}],commentStatus:'可加载更多'});
  assert.ok(text.includes('正文')); assert.ok(text.includes('丙')); assert.ok(!text.includes('SECRET'));
});

test('API post, comment and reply times accept seconds and milliseconds and render in Shanghai time',()=>{
  const seconds=Date.UTC(2026,9,9,0,30)/1000;
  const note=parseDetail({data:{items:[{id:'n',note_card:{note_id:'n',title:'Title',time:seconds,desc:'Body'}}]}},'n')!;
  const comments=parseComments({data:{comments:[{id:'c',content:'Root',create_time:seconds*1000,sub_comments:[{id:'r',content:'Reply',create_time:String(seconds+60)}]}]}});
  assert.equal(note.time,'2026-10-09 08:30');
  assert.equal(comments[0].time,'2026-10-09 08:30');
  assert.equal(comments[0].replies[0].time,'2026-10-09 08:31');
  assert.equal(mergeById(comments,parseComments({data:{comments:[{id:'c',content:'Root'}]}}))[0].time,'2026-10-09 08:30');
  const text=renderNote({...note,comments});assert.match(text,/2026-10-09 08:30/);assert.match(text,/2026-10-09 08:31/);
  const missing=parseDetail({data:{items:[{id:'n',note_card:{note_id:'n',title:'Title',last_update_time:seconds}}]}},'n')!;
  assert.equal(missing.time,undefined,'edit time must not be substituted for publication time');
  for(const create_time of [0,-1,'not a date',Infinity,123])assert.equal(parseComments({data:{comments:[{id:'c',create_time}]}})[0].time,undefined);
});
