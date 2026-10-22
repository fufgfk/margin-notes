import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'patchright-core';
import {Capture} from '../src/capture';
import {readChannelsDom} from '../src/dom';

test('discover feed captures its category and rejects late responses for other categories',()=>{
  const c=new Capture('discover','','homefeed.food_v3');
  const payload=(id:string)=>({success:true,data:{items:[{id,xsec_token:'token',note_card:{display_title:'文字'}}],has_more:true}});
  const url='https://edith.xiaohongshu.com/api/sns/web/v1/homefeed';
  c.accept(url,payload('old'),'homefeed_recommend');assert.equal(c.notes.length,0);
  c.accept(url,payload('food'),'homefeed.food_v3');assert.equal(c.notes[0].id,'food');assert.match(c.notes[0].url,/xsec_source=pc_feed/);
  c.accept(url,payload('more'),'homefeed.food_v3');assert.equal(c.notes.length,2);
  c.accept('https://so.xiaohongshu.com/api/sns/web/v2/search/notes',payload('search'),'homefeed.food_v3');assert.equal(c.notes.length,2);
});
test('categories come from visible discover tabs, with Recommendation first, excluding other navigation',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent('<span class="channel" id="unrelated">发布</span><div class="channel-container"><div class="channel" id="homefeed.food_v3">美食</div><div class="channel active" id="homefeed_recommend">推荐</div><div class="channel" id="future.category">新栏目</div><div class="channel" id="mobile" style="display:none">RED</div></div>');
    const channels=await page.evaluate(readChannelsDom);assert.deepEqual(channels.map(c=>c.name),['推荐','美食','新栏目']);assert.equal(channels[0].active,true);
  }finally{await browser.close();}
});
