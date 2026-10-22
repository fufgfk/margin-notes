import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {ReaderBrowser} from '../src/browser';

test('hide issued immediately after login prevents the pending browser launch',async()=>{
  const r=new ReaderBrowser('/unused-profile',()=>({headless:true}));
  let opened=0,closed=0;
  (r as any).ensure=async()=>{opened++;const ctx={pages:()=>[{goto:async()=>{},bringToFront:async()=>{}}],close:async()=>{closed++;}};(r as any).context=ctx;return ctx;};
  const login=r.login();const hide=r.close();await Promise.allSettled([login,hide]);
  assert.equal(opened,closed,'no context may remain open after hide');
});

test('clear rejects new login until profile deletion finishes',async()=>{
  const r=new ReaderBrowser('/unused-profile',()=>({headless:true}));
  let opened=0;
  (r as any).ensure=async()=>{opened++;const ctx={pages:()=>[{goto:async()=>{},bringToFront:async()=>{}}],close:async()=>{}};(r as any).context=ctx;return ctx;};
  let enter!:()=>void,release!:()=>void;
  const deleting=new Promise<void>(resolve=>{enter=resolve;});
  const held=new Promise<void>(resolve=>{release=resolve;});
  const replacement=mock.method(fs,'rm',async()=>{enter();await held;});
  try {
    const clear=r.clear();await deleting;
    const result=await r.login().then(()=> 'opened',()=> 'rejected');
    release();await clear;
    assert.equal(result,'rejected');assert.equal(opened,0);
  } finally {release();replacement.mock.restore();await r.close();}
});
