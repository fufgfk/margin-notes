import {BrowserContext,Page} from 'patchright-core';
import {access} from 'node:fs/promises';
import {join} from 'node:path';
import type {BrowserConfig} from './browser';
export async function backgroundPage(page:Page,config:BrowserConfig):Promise<void> {
    if(config.headless || config.backgroundWindow===false)return;
    let session:Awaited<ReturnType<BrowserContext['newCDPSession']>>|undefined;
    try {
      session=await page.context().newCDPSession(page);
      const {windowId}=await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}});
    }catch{
      await page.context().close().catch(()=>undefined);
      throw new Error('无法将阅读浏览器最小化。请关闭 Margin 的后台窗口设置后重试。');
    }
    finally{await session?.detach().catch(()=>undefined);}
  }
export async function createReadingPage(context:BrowserContext,config:BrowserConfig):Promise<Page> {
    if(config.headless || config.backgroundWindow===false)return context.newPage();
    // newPage() activates the tab and restores Chrome's minimized window.
    // Keep the persistent context's initial page as the background window anchor.
    const anchor=context.pages().find(page=>!page.isClosed());
    let session:Awaited<ReturnType<BrowserContext['newCDPSession']>>|undefined;
    let resolveTarget:(id:string)=>void=()=>undefined;
    try {
      if(!anchor)throw new Error('No reading window');
      session=await context.newCDPSession(anchor);
      const target=new Promise<string>(resolve=>{resolveTarget=resolve;});
      const ready=context.waitForEvent('page',{timeout:10000,predicate:async page=>{
        const id=await target;if(!id)return false;
        const probe=await context.newCDPSession(page);
        try{return (await probe.send('Target.getTargetInfo')).targetInfo.targetId===id;}
        finally{await probe.detach().catch(()=>undefined);}
      }});
      // Handle rejection even when target creation fails before ready is awaited.
      void ready.catch(()=>undefined);
      const {targetId}=await session.send('Target.createTarget',{url:'about:blank',background:true});
      resolveTarget(targetId);
      return await ready;
    }catch{
      resolveTarget('');
      await context.close().catch(()=>undefined);
      throw new Error('无法在后台创建阅读页面。请检查 Chrome 版本，或关闭 Margin 的后台窗口设置后重试。');
    }finally{await session?.detach().catch(()=>undefined);}
  }
export async function detectBrowser():Promise<string|undefined> {
  const paths=process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']:process.platform==='win32'?[
    join(process.env.PROGRAMFILES||'C:\\Program Files','Google/Chrome/Application/chrome.exe'),join(process.env['PROGRAMFILES(X86)']||'C:\\Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe')
  ]:['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/microsoft-edge'];
  for(const path of paths) {try{await access(path);return path;}catch{/* Try next known location. */}}
}
