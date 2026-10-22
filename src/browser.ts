import { chromium, BrowserContext, Page, Request } from 'patchright-core';
import { mkdir, chmod, rm } from 'node:fs/promises';
import {backgroundPage,createReadingPage,detectBrowser} from './browser-session';
import { Capture, classifyPage, requestAllowed } from './capture';
import { readSearchDom, readDetailDom, scrollContent, findCommentReplyButton, readChannelsDom } from './dom';
import { Channel, cleanText, mergeById, NoteDetail, NoteSummary, officialNoteUrl } from './model';

export interface BrowserConfig { headless:boolean; executablePath?:string; backgroundWindow?:boolean }
import type {SearchResult,DiscoverResult} from './reader';
export type {SearchResult,DiscoverResult} from './reader';
type Launcher=(profile:string, options:NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>)=>Promise<BrowserContext>;
type Observed={page:Page;capture:Capture;pending:Set<Promise<void>>;commentRequests:Set<Request>;dispose?:()=>void};
export interface PauseStore {paused:boolean;save(value:boolean):Promise<void>}
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
class RestrictedSession extends Error {}

export class ReaderBrowser {
  private context?:BrowserContext;
  private mode:'login'|'read'|undefined;
  private searchView?:Observed;
  private detailView?:Observed;
  private discoverView?:Observed;
  private activeChannel?:Channel;
  private channels:Channel[]=[];
  private visitedChannels=new Set<string>();
  private tail:Promise<unknown>=Promise.resolve();
  private generation=0;
  private intent=0;
  private observations=new WeakMap<Page,Observed>();
  private pauseWrites:Promise<void>=Promise.resolve();
  private clearing=false;
  private query='';
  private searchViewQuery='';
  private activeNote?:NoteSummary;
  private paused?:string;
  private stopping?:Promise<void>;
  private noteCache=new Map<string,NoteDetail>();
  private listCache=new Map<string,SearchResult|DiscoverResult>();
  private loginUrl='https://www.xiaohongshu.com/explore';
  constructor(private readonly profile:string,private readonly config:()=>BrowserConfig,private readonly launch:Launcher=(p,o)=>chromium.launchPersistentContext(p,o),private readonly pauseStore?:PauseStore){
    if(pauseStore?.paused)this.paused=this.pauseMessage('上次访问触发了网站限制。');
  }
  private pauseMessage(reason:string):string {return `小红书联网已暂停：${reason} 请稍后主动运行 Margin: 登录 / 处理验证；收起、重载或重新搜索不会自动重试。`;}
  private savePause(value:boolean):Promise<void> {
    const next=this.pauseWrites.catch(()=>undefined).then(()=>this.pauseStore?.save(value));
    this.pauseWrites=next;return next;
  }
  private run<T>(fn:()=>Promise<T>,allowPaused=false,supersede=true):Promise<T> {
    if(this.clearing) return Promise.reject(new Error('正在清除会话，请稍后重试'));
    const generation=this.generation,intent=supersede?++this.intent:this.intent;
    const next=this.tail.then(async()=>{
      if(this.paused && !allowPaused) throw new Error(this.paused);
      if(generation!==this.generation) throw new Error('阅读已收起');
      if(supersede && intent!==this.intent)throw new Error('阅读操作已取消');
      try {return await fn();}catch(error){
        if(error instanceof RestrictedSession) {
          await this.pause(error.message);
        }
        if(this.paused)throw new Error(this.paused);
        throw error;
      }
    });
    this.tail=next.catch(()=>undefined);return next;
  }
  private async pause(reason:string):Promise<void> {
    if(this.paused){await this.stopping;return;}
    this.paused=this.pauseMessage(reason);
    const saved=this.savePause(true).catch(()=>{this.paused+=' 暂停标记保存失败，重载前请停用插件。';});
    // Separate from close(): that method waits for the operation queue.
    const context=this.context;
    this.context=undefined;this.mode=undefined;this.searchView=undefined;this.detailView=undefined;this.discoverView=undefined;
    this.stopping=context?.close().catch(()=>undefined);
    await this.stopping;await saved;
  }
  private cached<T>(cache:Map<string,T>,key:string):T|undefined {
    const value=cache.get(key);if(!value)return;
    cache.delete(key);cache.set(key,value);
    return structuredClone(value);
  }
  private remember<T,U extends T>(cache:Map<string,T>,key:string,value:U,limit:number):U {
    cache.delete(key);cache.set(key,structuredClone(value));
    if(cache.size>limit)cache.delete(cache.keys().next().value!);
    return value;
  }
  private rememberList<T extends SearchResult>(key:string,value:T,refresh=false):T {
    const previous=refresh?undefined:this.listCache.get(key);
    const notes=mergeById(previous?.notes||[],value.notes).slice(0,500);
    const result={...value,notes,status:notes.length>value.notes.length?`已载入 ${notes.length} 条（含缓存）`:value.status};
    return this.remember(this.listCache,key,result,15);
  }
  private async background(page:Page):Promise<void> {if(this.mode==='read')await backgroundPage(page,this.config());}
  private async ensure(login=false):Promise<BrowserContext> {
    if(this.context) {
      if(this.mode==='login' && !login) throw new Error('登录窗口仍在打开。请先运行 Margin: 完成登录并关闭浏览器。');
      return this.context;
    }
    const generation=this.generation;
    const config=this.config();
    await mkdir(this.profile,{recursive:true,mode:0o700});
    if(process.platform!=='win32') await chmod(this.profile,0o700);
    const executablePath=config.executablePath || await detectBrowser();
    if(!executablePath) throw new Error('未找到 Chrome / Edge。请安装浏览器，或在 Margin 设置中指定可执行文件。');
    let context:BrowserContext;
    try {
      context=await this.launch(this.profile,{executablePath,headless:login?false:config.headless,viewport:null,acceptDownloads:false,serviceWorkers:'block',timeout:20000});
    } catch {
      throw new Error('无法启动专用浏览器。请检查浏览器路径，并关闭其他 Margin 登录窗口后重试。');
    }
    if(generation!==this.generation) {await context.close();throw new Error('阅读已收起');}
    this.context=context;this.mode=login?'login':'read';
    context.on('close',()=>{if(this.context===context){this.context=undefined;this.mode=undefined;this.searchView=undefined;this.detailView=undefined;this.discoverView=undefined;}});
    context.setDefaultTimeout(10000);context.setDefaultNavigationTimeout(25000);
    await context.route('**/*',async route=>{
      const request=route.request();
      if(requestAllowed(request.url(),request.resourceType(),login)) await route.fallback();
      else await route.abort();
    });
    context.on('page',page=>{page.on('dialog',dialog=>{void dialog.dismiss().catch(()=>undefined);});});
    if(!login)for(const page of context.pages())await this.background(page);
    return context;
  }
  private async readingPage(context:BrowserContext):Promise<Page> {return createReadingPage(context,this.config());}
  private async observe(kind:'search'|'detail'|'discover',noteId='',reuse?:Observed):Promise<Observed> {
    const context=await this.ensure();
    reuse?.dispose?.();
    const page=reuse && !reuse.page.isClosed() && reuse.page.context()===context?reuse.page:await this.readingPage(context),pending=new Set<Promise<void>>();
    await this.background(page);
    const view:Observed={page,capture:new Capture(kind,noteId),pending,commentRequests:new Set()};
    this.observations.set(page,view);
    const requests=new WeakSet<Request>();
    const generation=this.generation;
    const current=()=>this.context===context && this.generation===generation && !page.isClosed() && this.observations.get(page)===view;
    const onRequest=(request:Request)=>{
      requests.add(request);
      const url=new URL(request.url());
      if(kind==='detail' && /\/api\/sns\/web\/v\d+\/comment\/(?:sub\/)?page$/.test(url.pathname) && url.searchParams.get('note_id')===noteId) view.commentRequests.add(request);
    };
    const onFailed=(request:Request)=>view.commentRequests.delete(request);
    const onResponse=(response:import('patchright-core').Response)=>{
      if(!current() || !requests.has(response.request()))return;
      if([403,429].includes(response.status()) && /\/api\/sns\/web\//.test(response.url())){
        view.capture.apiError='网站拒绝了访问或要求降低访问频率。';
        void this.pause(view.capture.apiError);
        view.commentRequests.delete(response.request());return;
      }
      if(!response.url().includes('/api/sns/web/')) return;
      const task=(async()=>{
        try {
          const length=Number(response.headers()['content-length']||0);
          if(length>4_000_000 || !response.headers()['content-type']?.includes('json')) return;
          const body=await response.body();if(body.length>4_000_000) return;
          let category:string|undefined;
          try {const request=response.request().postDataJSON();if(typeof request?.category==='string') category=request.category;} catch { /* GET requests have no JSON body. */ }
          if(!current())return;
          view.capture.accept(response.url(),JSON.parse(body.toString('utf8')),category);
          if(view.capture.apiError)void this.pause(view.capture.apiError);
        } catch { /* Page close, non-JSON response or incomplete network request. */ }
        finally {view.commentRequests.delete(response.request());}
      })();
      pending.add(task);void task.finally(()=>pending.delete(task));
    };
    page.on('request',onRequest);page.on('requestfailed',onFailed);page.on('response',onResponse);
    view.dispose=()=>{
      if(this.observations.get(page)===view)this.observations.delete(page);
      page.off('request',onRequest);page.off('requestfailed',onFailed);page.off('response',onResponse);
    };
    return view;
  }
  private async navigate(view:Observed,url:string):Promise<void> {
    this.loginUrl=url;
    try {await view.page.goto(url,{waitUntil:'domcontentloaded'});} catch {
      if(view.page.isClosed()) throw new Error('阅读已收起');
      throw new Error('无法载入小红书页面。请检查网络，或运行 Margin: 登录 / 处理验证。');
    }
    await this.wait(view,true);
  }
  private async wait(view:Observed,initial=false,readyForChange?:()=>Promise<boolean>):Promise<void> {
    const deadline=Date.now()+(initial?10000:3500);
    const started=Date.now();
    while(Date.now()<deadline) {
      if(view.page.isClosed()) throw new Error('阅读已收起');
      const text=await view.page.locator('body').innerText({timeout:3000});
      const restriction=classifyPage(view.page.url(),text.slice(0,12000));
      if(restriction) throw new RestrictedSession(restriction);
      if(view.capture.apiError) throw new RestrictedSession(view.capture.apiError);
      if(/登录后查看|登录后搜索|登录后浏览/.test(text)) throw new Error('需要登录。请运行 Margin: 登录 / 处理验证，在官方窗口登录后重试。');
      if(readyForChange) {
        if(await readyForChange()) return;
      } else {
        const captured=view.capture.kind==='detail'?!!view.capture.detail:view.capture.notes.length>0||view.capture.searchHasMore===false;
        if(captured) return;
        // SSR is a fallback; allow a brief hydration window when no matching API data arrived.
        const ready=await view.page.locator(view.capture.kind==='detail'?'#detail-title, #detail-desc':'section.note-item, .feeds-container .note-item').count();
        if(ready && Date.now()-started>=250) return;
      }
      await delay(80);
    }
  }
  async login():Promise<void> {
    if(this.clearing) throw new Error('正在清除会话，请稍后重试');
    const generation=this.generation+1;
    await this.close();
    if(this.generation!==generation || this.clearing) throw new Error('阅读已收起');
    return this.run(async()=>{
      this.noteCache.clear();this.listCache.clear();
      const context=await this.ensure(true);
      const page=context.pages()[0]||await context.newPage();
      try {await page.goto(this.loginUrl,{waitUntil:'domcontentloaded'});} catch {throw new Error('登录窗口已打开，但官网尚未载入。请在浏览器中检查网络后重试。');}
      await page.bringToFront();
      try {await this.savePause(false);this.paused=undefined;}catch{
        await context.close().catch(()=>undefined);
        this.paused=this.pauseMessage('无法保存联网恢复状态。');throw new Error(this.paused);
      }
    },true,false);
  }
  async search(query:string,refresh=false,rehydrate=false):Promise<SearchResult> {
    query=cleanText(query,200);
    const key='search:'+query,cached=refresh||rehydrate?undefined:this.cached(this.listCache,key);
    return this.run(async()=>{
      this.query=cleanText(query,200);if(!this.query) throw new Error('请输入搜索词');
      if(cached)return {...cached,status:`已缓存 ${cached.notes.length} 条；点击刷新可重新读取`};
      this.searchView=await this.observe('search','',this.searchView);
      this.searchViewQuery=this.query;
      const url=new URL('https://www.xiaohongshu.com/search_result');url.searchParams.set('keyword',this.query);url.searchParams.set('source','web_search_result_notes');
      await this.navigate(this.searchView,url.href);
      return this.rememberList(key,await this.searchResult(this.searchView),refresh);
    },!!cached);
  }
  private async searchResult(view:Observed,matchingDomOnly=view.capture.kind==='discover' && view.capture.revision>0):Promise<SearchResult> {
    const allDom=await view.page.evaluate(readSearchDom);
    const ids=new Set(view.capture.notes.map(n=>n.id));
    const dom=matchingDomOnly?allDom.filter(n=>ids.has(n.id)):allDom;
    const safe=dom.flatMap(n=>{try{return [{...n,title:cleanText(n.title,500),author:cleanText(n.author,200),likes:cleanText(n.likes,30),url:officialNoteUrl(n.url)}];}catch{return [];}});
    // API carries more reliable ids/tokens; DOM may carry a usable token omitted by API.
    const domById=new Map(safe.map(n=>[n.id,n]));
    const enriched=view.capture.notes.map(n=>{
      const fallback=domById.get(n.id);
      return !new URL(n.url).searchParams.has('xsec_token') && fallback && new URL(fallback.url).searchParams.has('xsec_token') ? {...n,url:fallback.url}:n;
    });
    view.capture.notes=mergeById(safe,enriched).slice(0,500);
    const notes=view.capture.notes;
    if(!notes.length && view.capture.searchHasMore!==false) {
      const text=await view.page.locator('body').innerText();
      if(/登录|手机号|验证码/.test(text)) throw new Error('需要登录或人工验证。请运行 Margin: 登录 / 处理验证。');
      if(!/暂无|没有找到|无相关|无搜索结果/.test(text)) throw new Error('暂未识别到列表内容。官网可能仍在加载、限制了访问或更新了页面结构。');
    }
    return {notes,hasMore:view.capture.searchHasMore!==false&&notes.length<500,status:notes.length?`已载入 ${notes.length} 条`:'没有找到相关笔记'};
  }
  async moreSearch():Promise<SearchResult> {
    if(!this.searchView || this.searchView.page.isClosed() || this.searchViewQuery!==this.query) return this.search(this.query,false,true);
    return this.run(async()=>{
      const view=this.searchView;if(!view) throw new Error('请重新搜索');
      const before=view.capture.notes.length;
      await this.loadMoreList(view);
      const result=await this.searchResult(view);
      if(result.notes.length===before&&result.hasMore) result.status='本次没有新增结果；可稍后再试';
      return this.rememberList('search:'+this.query,result);
    });
  }
  private async loadMoreList(view:Observed):Promise<void> {
    const revision=view.capture.revision;
    const before=(await view.page.evaluate(readSearchDom)).map(n=>n.id).join(',');
    // One scroll to the feed bottom triggers the site's pagination without three blind retries.
    await view.page.evaluate(scrollContent,true);
    await this.wait(view,false,async()=>view.capture.revision>revision || (await view.page.evaluate(readSearchDom)).map(n=>n.id).join(',')!==before);
  }
  async discover(channelId?:string,refresh=false):Promise<DiscoverResult> {
    const id=channelId||this.channels.find(c=>c.name==='推荐')?.id||'homefeed_recommend';
    const cached=refresh?undefined:this.cached(this.listCache,'discover:'+id) as DiscoverResult|undefined;
    return this.run(()=>{
      if(cached){this.activeChannel=cached.channel;this.channels=cached.channels;return Promise.resolve({...cached,status:`已缓存 ${cached.notes.length} 条；点击刷新可重新读取`});}
      return this.openDiscover(channelId,refresh);
    },!!cached);
  }
  private async openDiscover(channelId?:string,refresh=false):Promise<DiscoverResult> {
    const generation=this.generation;
    // Switching tabs reuses the hydrated homepage. Selecting the current tab is a refresh.
    let view=this.discoverView;
    const targetId=channelId||this.channels.find(c=>c.name==='推荐')?.id;
    const canReuse=view && !view.page.isClosed() && this.activeChannel && targetId && view.capture.channelId===this.activeChannel.id && targetId!==this.activeChannel.id && !this.visitedChannels.has(targetId);
    if(!canReuse) {
      view=await this.observe('discover','',view);this.discoverView=view;
      this.visitedChannels.clear();
      await this.navigate(view,'https://www.xiaohongshu.com/explore');
    }
    if(!view) throw new Error('请重新打开发现');
    const tabs=await view.page.evaluate(readChannelsDom);
    for(const tab of tabs)if(tab.active)this.visitedChannels.add(tab.id);
    const target=channelId?tabs.find(c=>c.id===channelId):tabs.find(c=>c.name==='推荐');
    if(!target) throw new Error('暂未找到该发现栏目。请重新打开发现，刷新官网栏目列表。');
    let matchingDomOnly=false;
    if(!target.active) {
      view.capture=new Capture('discover','',target.id);
      await view.page.locator(`[id="${target.id}"]`).click();
      const current=view;
      await this.wait(view,true,async()=>current.capture.notes.length>0 || current.capture.searchHasMore===false);
      const selected=(await view.page.evaluate(readChannelsDom)).find(c=>c.id===target.id)?.active;
      if(!selected || !view.capture.revision) throw new Error('暂未取得新栏目的内容，请稍后重试。');
      // The response can arrive before Vue replaces the old cards. Never merge those cards.
      matchingDomOnly=true;
    } else {
      const filtered=new Capture('discover','',target.id);
      Object.assign(filtered,{notes:view.capture.notes,searchHasMore:view.capture.searchHasMore,revision:view.capture.revision});
      view.capture=filtered;
    }
    const result=await this.searchResult(view,matchingDomOnly || view.capture.revision>0);
    if(generation!==this.generation) throw new Error('阅读已收起');
    this.activeChannel={id:target.id,name:cleanText(target.name,50)};
    this.visitedChannels.add(target.id);
    this.channels=tabs.map(c=>({id:c.id,name:cleanText(c.name,50)}));
    return this.rememberList('discover:'+this.activeChannel.id,{...result,channels:this.channels,channel:this.activeChannel},refresh);
  }
  async moreDiscover():Promise<DiscoverResult> {
    return this.run(async()=>{
      if(!this.discoverView || this.discoverView.page.isClosed() || this.discoverView.capture.channelId!==this.activeChannel?.id) return this.openDiscover(this.activeChannel?.id);
      const view=this.discoverView,channel=this.activeChannel;
      if(!channel || view.capture.channelId!==channel.id) throw new Error('请重新打开发现栏目');
      const before=view.capture.notes.length;
      await this.loadMoreList(view);
      const result=await this.searchResult(view);
      if(result.notes.length===before&&result.hasMore) result.status='本次没有新增内容；可稍后再试或刷新栏目';
      return this.rememberList('discover:'+channel.id,{...result,channels:this.channels,channel});
    });
  }
  async detail(note:NoteSummary,refresh=false):Promise<NoteDetail> {
    const cached=refresh?undefined:this.cached(this.noteCache,note.id);
    return this.run(()=>{
      if(cached){this.activeNote=note;return Promise.resolve(cached);}
      return this.openDetail(note,refresh);
    },!!cached);
  }
  private async openDetail(note:NoteSummary,refresh=false):Promise<NoteDetail> {
    const generation=this.generation;
    const url=officialNoteUrl(note.url), candidate={...note,url};
    this.detailView=await this.observe('detail',note.id,this.detailView);
    await this.navigate(this.detailView,url);
    const result=await this.detailResult(this.detailView,candidate,refresh);
    if(generation!==this.generation) throw new Error('阅读已收起');
    this.activeNote=candidate;
    return result;
  }
  private async detailResult(view:Observed,note:NoteSummary,refresh=false):Promise<NoteDetail> {
    const dom=await view.page.evaluate(readDetailDom);
    const found=view.capture.detail;
    if(!found && !dom.title && !dom.text) throw new Error('暂未读取到正文。请检查登录状态，或该笔记是否已删除/限制访问。');
    const comments=view.capture.comments.length?view.capture.comments:dom.comments;
    const commentStatus=view.capture.commentHasMore===false?'一级评论已全部加载':comments.length?'可继续加载一级评论':'尚未取得评论；可尝试加载更多';
    const previous=refresh?undefined:this.noteCache.get(note.id);
    return this.remember(this.noteCache,note.id,{...note,time:found?.time||cleanText(dom.time,100)||previous?.time,title:found?.title||cleanText(dom.title)||note.title,author:found?.author||cleanText(dom.author)||note.author,text:found?.text||cleanText(dom.text),comments:mergeById(previous?.comments||[],comments),commentStatus,commentHasMore:view.capture.commentHasMore},30);
  }
  async moreComments(note:NoteSummary|undefined=this.activeNote):Promise<NoteDetail> {
    return this.run(async()=>{
      if(!note) throw new Error('请先打开一篇笔记');
      if(!this.detailView || this.detailView.page.isClosed() || this.detailView.capture.noteId!==note.id) {
        await this.openDetail(note);
      }
      const view=this.detailView;if(!view)throw new Error('请重新打开笔记');
      const revision=view.capture.commentRevision;
      const before=JSON.stringify((await view.page.evaluate(readDetailDom)).comments);
      await view.page.evaluate(scrollContent,true);
      await this.wait(view,false,async()=>!view.commentRequests.size && (view.capture.commentRevision>revision || JSON.stringify((await view.page.evaluate(readDetailDom)).comments)!==before));
      return this.detailResult(view,note);
    });
  }
  async moreReplies(note:NoteDetail,commentId:string):Promise<NoteDetail> {
    return this.run(async()=>{
      const target=note.comments.find(c=>c.id===commentId);
      if(!target)throw new Error('请先选择一条已读取的一级评论');
      if(!this.detailView || this.detailView.page.isClosed() || this.detailView.capture.noteId!==note.id)await this.openDetail(note);
      const view=this.detailView;if(!view)throw new Error('请重新打开笔记');
      // Keep the selected root available for API replies even after the browser was reopened.
      const hadTarget=view.capture.comments.some(c=>c.id===commentId);
      const revision=view.capture.replyRevisions.get(commentId)||0;
      view.capture.comments=mergeById(view.capture.comments,[target]);
      const readTarget=async()=>{
        const comments=(await view.page.evaluate(readDetailDom)).comments;
        const exact=comments.find(c=>c.id===commentId);if(exact)return exact;
        const matches=comments.filter(c=>cleanText(c.text)===target.text && cleanText(c.author)===target.author);
        return matches.length===1?{...matches[0],id:commentId}:undefined;
      };
      const before=JSON.stringify(await readTarget());
      try {
        const selector=await view.page.evaluate(findCommentReplyButton,target);
        if(!selector)throw new Error('暂未找到这条评论的展开按钮。请重新加载一级评论后再试。');
        await view.page.locator(selector).click();
        await this.wait(view,false,async()=>!view.commentRequests.size && ((view.capture.replyRevisions.get(commentId)||0)>revision || JSON.stringify(await readTarget())!==before));
        const fromApi=(view.capture.replyRevisions.get(commentId)||0)>revision;
        const updated=fromApi?view.capture.comments.find(c=>c.id===commentId):await readTarget();
        // Incidental website scrolling must not append unrelated root comments to this action.
        return this.remember(this.noteCache,note.id,{...note,comments:note.comments.map(c=>c.id===commentId&&updated?{...updated,time:updated.time||c.time,replies:mergeById(c.replies,updated.replies)}:c)},30);
      }finally{
        // A temporary API seed must not disable DOM-only reading after a failed/no-API expansion.
        if(!hadTarget && (view.capture.replyRevisions.get(commentId)||0)===revision)view.capture.comments=view.capture.comments.filter(c=>c.id!==commentId);
      }
    });
  }
  async close():Promise<void> {
    this.generation++;
    const context=this.context;
    this.context=undefined;this.mode=undefined;this.searchView=undefined;this.detailView=undefined;this.discoverView=undefined;
    if(context) await context.close();
    await this.stopping;await this.pauseWrites.catch(()=>undefined);
    // An in-flight launch notices the generation change and closes its own context.
    await this.tail.catch(()=>undefined);
  }
  async clear():Promise<void> {
    if(this.clearing) throw new Error('正在清除会话，请稍后重试');
    this.clearing=true;
    try {
      await this.close();
      this.noteCache.clear();this.listCache.clear();
      this.query='';this.activeNote=undefined;this.activeChannel=undefined;this.channels=[];this.loginUrl='https://www.xiaohongshu.com/explore';
      await rm(this.profile,{recursive:true,force:true});
    } finally {this.clearing=false;}
  }
}
