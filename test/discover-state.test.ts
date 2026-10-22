import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReadingState} from '../src/state';
test('default entry is recommended discovery; hide keeps the last reading surface',()=>{
  const state=new ReadingState();assert.equal(state.resumeTarget,'discover');
  state.listReady=true;state.lastView='list';state.hide();assert.equal(state.resumeTarget,'list');
  state.note={id:'a',title:'t',author:'a',likes:'',url:'https://www.xiaohongshu.com/explore/a',text:'x',comments:[],commentStatus:''};
  state.lastView='note';state.hide();assert.equal(state.resumeTarget,'note');
});
test('switching list source clears stale results and clearing restores discover default',()=>{
  const state=new ReadingState();state.results=[{id:'a',title:'old',author:'a',likes:'',url:'https://www.xiaohongshu.com/explore/a'}];state.listReady=true;
  state.resetList('search','咖啡');assert.equal(state.source,'search');assert.equal(state.query,'咖啡');assert.equal(state.results.length,0);assert.equal(state.listReady,false);
  state.channel={id:'food',name:'美食'};state.channels=[state.channel];state.clear();assert.equal(state.source,'discover');assert.equal(state.channel,undefined);assert.deepEqual(state.channels,[]);assert.equal(state.resumeTarget,'discover');
});
