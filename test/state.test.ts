import {test} from 'node:test';
import assert from 'node:assert/strict';
import { ReadingState } from '../src/state';
test('hide invalidates pending actions so late results cannot reopen reading',()=>{
  const state=new ReadingState();const ticket=state.begin();assert.equal(state.current(ticket),true);
  state.hide();assert.equal(state.current(ticket),false);
  const next=state.begin();assert.equal(state.current(next),true);assert.equal(state.current(ticket),false);
});
test('new search supersedes previous results and clear removes retained content',()=>{
  const state=new ReadingState();const first=state.begin();state.begin();assert.equal(state.current(first),false);
  state.note={id:'a',title:'标题',author:'甲',likes:'0',url:'https://www.xiaohongshu.com/explore/a',text:'正文',comments:[],commentStatus:''};
  state.results=[state.note];state.query='私密词';state.clear();assert.equal(state.note,undefined);assert.equal(state.query,'');assert.deepEqual(state.results,[]);
});
