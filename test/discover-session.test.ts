import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'patchright-core';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReaderBrowser} from '../src/browser';

test('discover defaults to recommendation, switches tabs without mixed data and paginates the selected feed',async()=>{
  let navigations=0;
  const root=await mkdtemp(join(tmpdir(),'margin-discover-'));
  const reader=new ReaderBrowser(join(root,'profile'),()=>({headless:true}),async(profile,options)=>{
    const context=await chromium.launchPersistentContext(profile,{...options,channel:'chrome'});
    await context.route('https://**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname.endsWith('/homefeed')) {
        const body=route.request().postDataJSON(),food=body.category==='homefeed.food_v3';
        // Retain old cards during a slow category response; late recommendation data must be ignored.
        await new Promise(resolve=>setTimeout(resolve,food?2500:2200));
        const id=(food?'food':'recLate')+(body.page||1);
        await route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({success:true,data:{items:[{id,xsec_token:'TOKEN',note_card:{display_title:id}}],has_more:true}})});
      }else{
        navigations++;
        await route.fulfill({contentType:'text/html; charset=utf-8',body:`<html><body style="height:4500px"><div class="channel-container"><div id="homefeed_recommend" class="channel" onclick="choose(this)"><div class="channel-content active">推荐</div></div><div id="homefeed.food_v3" class="channel" onclick="choose(this)"><div class="channel-content">美食</div></div></div><main id="cards"><section class="note-item"><a href="https://www.xiaohongshu.com/explore/rec1?xsec_token=t"></a><span class="title">rec1</span></section></main><script>
        let category='homefeed_recommend',page=1;
        async function load(){const j=await (await fetch('https://edith.xiaohongshu.com/api/sns/web/v1/homefeed',{method:'POST',body:JSON.stringify({category,page})})).json();{if(j.data.items[0].id.startsWith('food')&&page===1)cards.innerHTML='';cards.insertAdjacentHTML('beforeend',j.data.items.map(n=>'<section class="note-item"><a href="https://www.xiaohongshu.com/explore/'+n.id+'?xsec_token=t"></a><span class="title">'+n.id+'</span></section>').join(''));}}
        function choose(el){document.querySelector('.active').classList.remove('active');el.firstElementChild.classList.add('active');category=el.id;page=1;load();}
        window.addEventListener('scroll',()=>{if(page===1){page=2;load();}});load();
        </script></body></html>`});
      }
    });return context;
  });
  try{
    const initial=await reader.discover();assert.equal(initial.channel.name,'推荐');assert.ok(initial.notes.every(n=>n.id.startsWith('rec')));
    const food=await reader.discover('homefeed.food_v3');assert.equal(food.channel.name,'美食');assert.deepEqual(food.notes.map(n=>n.id),['food1']);assert.equal(navigations,1,'switching categories must reuse the loaded homepage');
    const more=await reader.moreDiscover();assert.ok(more.notes.some(n=>n.id==='food2'));assert.ok(more.notes.every(n=>n.id.startsWith('food')));
    const beforeCached=navigations;
    const cachedRec=await reader.discover();assert.ok(cachedRec.notes.every(n=>n.id.startsWith('rec')));
    const cachedFood=await reader.discover('homefeed.food_v3');assert.ok(cachedFood.notes.some(n=>n.id==='food2'));
    assert.equal(navigations,beforeCached,'returning to cached channels must not navigate');
    await reader.close();const reopened=await reader.moreDiscover();assert.equal(reopened.channel.name,'美食');assert.ok(reopened.notes.every(n=>n.id.startsWith('food')));
    const retained=await reader.discover('homefeed.food_v3');assert.ok(retained.notes.some(n=>n.id==='food2'),'restoring a browser must not discard already cached pages');
    await assert.rejects(reader.discover('nonexistent'),/栏目/);
  }finally{await reader.close();await rm(root,{recursive:true,force:true});}
});
