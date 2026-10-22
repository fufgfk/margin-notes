import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PlatformState,contentKey} from '../src/platform-state';
test('switching invalidates old tickets while retaining separate reading state',()=>{
  const p=new PlatformState();assert.equal(p.platform,'xiaohongshu');
  const ticket=p.begin();p.state('xiaohongshu').query='coffee';
  p.select('zhihu');assert.equal(p.current(ticket,'xiaohongshu'),false);
  p.state('zhihu').query='programming';p.select('xiaohongshu');
  assert.equal(p.state('xiaohongshu').query,'coffee');assert.equal(p.state('zhihu').query,'programming');
  const next=p.begin();assert.equal(p.current(next,'xiaohongshu'),true);
});
test('content identity includes both platform and kind',()=>{
  const ids=[contentKey({id:'1'}),contentKey({id:'1',platform:'zhihu',kind:'answer'}),contentKey({id:'1',platform:'zhihu',kind:'question'})];
  assert.equal(new Set(ids).size,3);
});
