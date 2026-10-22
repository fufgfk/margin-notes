import {chromium,BrowserContext,Page,Request,Response} from 'patchright-core';
import {mkdir,chmod,rm} from 'node:fs/promises';
import type {BrowserConfig,PauseStore} from '../browser';
import {backgroundPage,createReadingPage,detectBrowser} from '../browser-session';
import {Reader,SearchResult,DiscoverResult} from '../reader';
import {NoteDetail,NoteSummary,mergeById,cleanText} from '../model';
import {contentKey} from '../platform-state';
import {officialZhihuUrl,zhihuRequestAllowed,mergeZhihu} from './model';
import {ZhihuCapture,ViewKind} from './capture';
import {readZhihuListDom,readZhihuDetailDom,findZhihuReplyButton,findZhihuCommentControl} from './dom';
type Launcher=(profile:string,options:NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>)=>Promise<BrowserContext>;
type View={page:Page;capture:ZhihuCapture;key:string;dispose:()=>void};
const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
const recommend={id:'recommend',name:'首页推荐'};
class Restriction extends Error {}
export class ZhihuReader implements Reader {
 private context?:BrowserContext;private mode?:'login'|'read';
 private views=new Map<ViewKind,View>();private observed=new WeakMap<Page,View>();
 private generation=0;private intent=0;private tail:Promise<unknown>=Promise.resolve();private stopping?:Promise<void>;
 private pauseWrites:Promise<void>=Promise.resolve();private paused=false;private clearing=false;
 private lists=new Map<string,SearchResult>();private notes=new Map<string,NoteDetail>();
 private noProgress=new Set<string>();
 private query='';private question?:NoteSummary;private active?:NoteSummary;private loginUrl='https://www.zhihu.com/';
 constructor(private readonly profile:string,private readonly config:()=>BrowserConfig,private readonly launch:Launcher=(p,o)=>chromium.launchPersistentContext(p,o),private readonly pauseStore?:PauseStore){this.paused=!!pauseStore?.paused;}
 private pausedMessage():string{return '知乎联网已暂停：网站要求验证或限制了访问。请稍后主动运行 Margin: 登录 / 处理验证；重载或刷新不会自动重试。';}
 private savePause(value:boolean):Promise<void>{const n=this.pauseWrites.catch(()=>undefined).then(()=>this.pauseStore?.save(value));this.pauseWrites=n;return n;}
 private async pause():Promise<void>{if(this.paused){await this.stopping;return;}this.paused=true;const c=this.context;this.context=undefined;this.mode=undefined;this.views.forEach(v=>v.dispose());this.views.clear();this.stopping=c?.close().catch(()=>undefined);await this.savePause(true);await this.stopping;}
 private run<T>(fn:()=>Promise<T>,allowPaused=false,supersede=true):Promise<T>{
  if(this.clearing)return Promise.reject(new Error('正在清除知乎会话，请稍后重试'));
  const gen=this.generation,intent=supersede?++this.intent:this.intent;
  const task=this.tail.then(async()=>{
   if(gen!==this.generation||supersede&&intent!==this.intent)throw new Error('阅读已收起或操作已取消');
   if(this.paused&&!allowPaused)throw new Error(this.pausedMessage());
   try{const value=await fn();if(gen!==this.generation)throw new Error('阅读已收起');if(this.paused&&!allowPaused)throw new Error(this.pausedMessage());return value;}
   catch(e){if(e instanceof Restriction)await this.pause();if(this.paused&&!allowPaused)throw new Error(this.pausedMessage());throw e;}
  });this.tail=task.catch(()=>undefined);return task;
 }
 private cached<T>(map:Map<string,T>,key:string):T|undefined{if(this.clearing)return;const v=map.get(key);if(!v)return;map.delete(key);map.set(key,v);return structuredClone(v);}
 private keep<T>(map:Map<string,T>,key:string,value:T,limit:number):T {map.delete(key);map.set(key,structuredClone(value));if(map.size>limit)map.delete(map.keys().next().value!);return value;}
 private async ensure(login=false):Promise<BrowserContext>{
  if(this.context){if(this.mode==='login'&&!login)throw new Error('登录窗口仍在打开。请先运行 Margin: 完成登录并关闭浏览器。');return this.context;}
  const gen=this.generation,cfg=this.config();await mkdir(this.profile,{recursive:true,mode:0o700});if(process.platform!=='win32')await chmod(this.profile,0o700);
  const executablePath=cfg.executablePath||await detectBrowser();if(!executablePath)throw new Error('未找到 Chrome / Edge，请检查 Margin 浏览器设置。');
  let c:BrowserContext;try{c=await this.launch(this.profile,{executablePath,headless:login?false:cfg.headless,viewport:null,acceptDownloads:false,serviceWorkers:'block',timeout:20000});}catch{throw new Error('无法启动知乎专用浏览器，请检查路径并关闭其他知乎登录窗口。');}
  if(gen!==this.generation){await c.close();throw new Error('阅读已收起');}this.context=c;this.mode=login?'login':'read';
  c.on('close',()=>{if(this.context===c){this.context=undefined;this.mode=undefined;this.views.forEach(v=>v.dispose());this.views.clear();}});
  c.setDefaultTimeout(8000);c.setDefaultNavigationTimeout(25000);
  await c.route('**/*',route=>zhihuRequestAllowed(route.request().url())?route.fallback():route.abort());
  c.on('page',page=>{page.on('dialog',dialog=>{void dialog.dismiss().catch(()=>undefined);});});
  if(!login)for(const p of c.pages())await backgroundPage(p,cfg);
  return c;
 }
 private async observe(kind:ViewKind,key:string,content?:NoteSummary):Promise<View>{
  const c=await this.ensure(),old=this.views.get(kind);old?.dispose();
  const page=old&&!old.page.isClosed()&&old.page.context()===c?old.page:await createReadingPage(c,this.config());await backgroundPage(page,this.config());
  const cap=new ZhihuCapture(kind,content),requests=new WeakSet<Request>();const gen=this.generation;
  const current=()=>this.context===c&&gen===this.generation&&!page.isClosed()&&this.observed.get(page)===view;
  const onRequest=(r:Request)=>{requests.add(r);};
  const onResponse=(r:Response)=>{
   if(!current()||!requests.has(r.request())||!cap.accepts(r.url()))return;
   if([401,403,429].includes(r.status())){void this.pause().catch(()=>undefined);return;}
   const task=(async()=>{try{
    if(!r.headers()['content-type']?.includes('json')||Number(r.headers()['content-length']||0)>4000000)return;
    const bytes=await r.body();if(!current()||bytes.length>4000000)return;cap.accept(r.url(),JSON.parse(bytes.toString('utf8')));if(cap.apiError)await this.pause();
   }catch{/* Closed page, invalid JSON, or interrupted network. */}})();void task;
  };
  const view:View={page,capture:cap,key,dispose:()=>{if(this.observed.get(page)===view)this.observed.delete(page);page.off('request',onRequest);page.off('response',onResponse);}};
  this.observed.set(page,view);page.on('request',onRequest);page.on('response',onResponse);this.views.set(kind,view);return view;
 }
 private async check(view:View):Promise<void>{
  if(this.paused)throw new Restriction(this.pausedMessage());if(view.page.isClosed())throw new Error('阅读已收起');
  const u=new URL(view.page.url());
  if(/\/account\/unhuman|\/captcha|\/security/.test(u.pathname))throw new Restriction('知乎要求安全验证');
  if(/\/signin/.test(u.pathname))throw new Error('需要登录知乎。请运行 Margin: 登录 / 处理验证。');
  const signals=await view.page.evaluate(()=>({title:document.title,body:(document.body?.innerText||'').trim().slice(0,400),captcha:!!document.querySelector('.Captcha,.CaptchaContainer,[class*="Unhuman"]')}));
  if(signals.captcha||/安全验证|访问受限|请求过于频繁/.test(signals.title)||/^(安全验证|请求过于频繁|访问受限)$/.test(signals.body))throw new Restriction('知乎要求人工验证或限制了访问');
  if(view.capture.apiError)throw new Restriction(view.capture.apiError);
  if(view.capture.schemaError)throw new Error(view.capture.schemaError);
 }
 private async wait(view:View,ready:()=>Promise<boolean>,initial=false):Promise<boolean>{
  const until=Date.now()+(initial?10000:3500);while(Date.now()<until){await this.check(view);if(await ready())return true;await delay(80);}await this.check(view);return false;
 }
 private async navigate(view:View,url:string):Promise<void>{
  this.loginUrl=url;let response:Response|null;
  try{response=await view.page.goto(url,{waitUntil:'domcontentloaded'});}catch{if(this.paused)throw new Restriction(this.pausedMessage());throw new Error('无法载入知乎页面。请检查网络或使用登录 / 处理验证。');}
  if(response&&[401,403,429].includes(response.status()))throw new Restriction('知乎限制了页面访问');
 }
 private async listResult(view:View):Promise<SearchResult>{
  const dom=await readZhihuListDom(view.page),cap=view.capture;
  let notes=cap.notes.length?cap.notes:dom.notes;
  if(view.capture.kind==='answers')notes=notes.filter(n=>n.kind==='answer'&&n.questionId===view.capture.content?.id);
  return {notes,hasMore:cap.hasMore??dom.hasMore,status:`已载入 ${notes.length} 条`};
 }
 private async openList(kind:Exclude<ViewKind,'detail'>,key:string,url:string,force=false,content?:NoteSummary):Promise<SearchResult>{
  if(force)this.noProgress.delete(key);
  const v=await this.observe(kind,key,content);await this.navigate(v,url);
  const ready=await this.wait(v,async()=>v.capture.revision>0||(await readZhihuListDom(v.page)).notes.length>0||await v.page.locator('.EmptyState,.List-end').count()>0,true);
  if(!ready)throw new Error('暂未读取到知乎列表。可能需要登录，或官网页面结构已变化。');
  const r=await this.listResult(v),old=force?undefined:this.lists.get(key);r.notes=mergeZhihu(old?.notes||[],r.notes);r.status=`已载入 ${r.notes.length} 条`;
  return this.keep(this.lists,key,r,15);
 }
 async discover(_channelId?:string,refresh=false):Promise<DiscoverResult>{
  const wrap=(r:SearchResult)=>({...r,channel:recommend,channels:[recommend]});const cached=!refresh&&this.cached(this.lists,'discover');if(cached)return wrap(cached);
  return this.run(async()=>wrap(await this.openList('discover','discover','https://www.zhihu.com/',refresh)));
 }
 async search(query:string,refresh=false):Promise<SearchResult>{
  query=cleanText(query,200);if(!query)throw new Error('请输入知乎搜索关键词');this.query=query;
  const key='search:'+query,cached=!refresh&&this.cached(this.lists,key);if(cached)return cached;
  return this.run(()=>this.openList('search',key,`https://www.zhihu.com/search?type=content&q=${encodeURIComponent(query)}`,refresh));
 }
 async answers(question:NoteSummary,refresh=false):Promise<SearchResult>{
  if(question.kind!=='question'||question.platform!=='zhihu')throw new Error('请选择知乎问题');officialZhihuUrl(question.url);this.question=question;
  const key='answers:'+question.id,cached=!refresh&&this.cached(this.lists,key);if(cached)return cached;
  return this.run(()=>this.openList('answers',key,officialZhihuUrl(question.url),refresh,question));
 }
 private async moreList(kind:Exclude<ViewKind,'detail'>,key:string,url:string,content?:NoteSummary):Promise<SearchResult>{
  if(this.noProgress.has(key))throw new Error('暂未读取到新增知乎内容。请刷新当前列表后再试。');
  let v=this.views.get(kind);if(!v||v.key!==key||v.page.isClosed()){await this.openList(kind,key,url,false,content);v=this.views.get(kind)!;}
  const old=this.lists.get(key),signature=(r:SearchResult)=>JSON.stringify({ids:mergeZhihu(old?.notes||[],r.notes).map(contentKey),hasMore:r.hasMore}),before=signature(await this.listResult(v));
  const button=v.page.getByRole('button',{name:/^(加载更多|更多回答|查看更多|加载更多结果)$/}).first();
  if(await button.count())await button.click();else await v.page.evaluate(()=>{window.scrollTo(0,document.documentElement.scrollHeight);});
  const changed=await this.wait(v,async()=>signature(await this.listResult(v!))!==before);
  if(!changed){this.noProgress.add(key);throw new Error('暂未读取到新增知乎内容。请刷新当前列表后再试；也可能是官网分页结构变化。');}
  const r=await this.listResult(v);r.notes=mergeZhihu(old?.notes||[],r.notes);r.status=`已载入 ${r.notes.length} 条`;return this.keep(this.lists,key,r,15);
 }
 async moreDiscover():Promise<DiscoverResult>{return this.run(async()=>({...await this.moreList('discover','discover','https://www.zhihu.com/'),channel:recommend,channels:[recommend]}));}
 async moreSearch():Promise<SearchResult>{const q=this.query;if(!q)throw new Error('请先搜索知乎');return this.run(()=>this.moreList('search','search:'+q,`https://www.zhihu.com/search?type=content&q=${encodeURIComponent(q)}`));}
 async moreAnswers():Promise<SearchResult>{const q=this.question;if(!q)throw new Error('请先打开知乎问题');return this.run(()=>this.moreList('answers','answers:'+q.id,officialZhihuUrl(q.url),q));}
 private async detailResult(v:View,note:NoteSummary,refresh=false):Promise<NoteDetail>{
  const dom=await readZhihuDetailDom(v.page,note),api=v.capture.detail,prev=refresh?undefined:this.notes.get(contentKey(note));if(!dom&&!api)throw new Error('暂未读取到知乎正文。可能需要登录、内容受限或官网结构变化。');
  const result:NoteDetail={...note,...dom,...api,text:api?.text||dom?.text||'',accessNotice:api?.accessNotice||dom?.accessNotice||prev?.accessNotice,comments:mergeById(prev?.comments||[],v.capture.comments.length?v.capture.comments:dom?.comments||[]),commentHasMore:v.capture.commentHasMore??dom?.commentHasMore??api?.commentHasMore,commentStatus:''};
  result.time=result.time||prev?.time;result.commentStatus=result.commentHasMore===false?'一级评论已全部加载':result.comments.length?'可继续加载一级评论':'评论尚未加载';return this.keep(this.notes,contentKey(note),result,30);
 }
 private async openDetail(note:NoteSummary,refresh=false):Promise<NoteDetail>{
  if(note.platform!=='zhihu'||!['answer','article'].includes(note.kind||''))throw new Error('请选择知乎回答或文章');
  const key=contentKey(note);if(refresh)for(const entry of this.noProgress)if(entry.startsWith(key+':'))this.noProgress.delete(entry);const v=await this.observe('detail',key,note);await this.navigate(v,officialZhihuUrl(note.url));
  const started=Date.now();const ready=await this.wait(v,async()=>!!v.capture.detail||(Date.now()-started>=250&&!!await readZhihuDetailDom(v.page,note)),true);if(!ready)throw new Error('暂未读取到知乎正文。请检查登录状态或内容访问权限。');return this.detailResult(v,note,refresh);
 }
 async detail(note:NoteSummary,refresh=false):Promise<NoteDetail>{this.active=note;const c=!refresh&&this.cached(this.notes,contentKey(note));if(c)return c;return this.run(()=>this.openDetail(note,refresh));}
 private async detailView(note:NoteSummary):Promise<View>{let v=this.views.get('detail');if(!v||v.key!==contentKey(note)||v.page.isClosed()){await this.openDetail(note);v=this.views.get('detail')!;}return v;}
 async moreComments(note=this.active):Promise<NoteDetail>{
  if(!note)return Promise.reject(new Error('请先打开知乎正文'));
  return this.run(async()=>{
   const blocked=contentKey(note)+':roots';if(this.noProgress.has(blocked))throw new Error('暂未读取到新增知乎评论。请刷新正文后重试。');
   const v=await this.detailView(note),cap=v.capture;
   const previous=this.notes.get(contentKey(note));
   const snapshot=async()=>{const d=await readZhihuDetailDom(v.page,note);return JSON.stringify({ids:mergeById(previous?.comments||[],cap.comments.length?cap.comments:d?.comments||[]).map(c=>c.id),hasMore:cap.commentHasMore??d?.commentHasMore});};
   const before=await snapshot();
   const more=await findZhihuCommentControl(v.page,note,'more'),initial=await findZhihuCommentControl(v.page,note,'initial');
   const opening=!more&&cap.commentRevision===0&&!!initial;
   if(more)await v.page.locator(more).click();
   else if(cap.commentRevision===0&&initial)await v.page.locator(initial).click();
   else {const area=await findZhihuCommentControl(v.page,note,'scroll');if(!area)throw new Error('暂未找到当前正文的评论加载入口。请在官网检查评论是否可用。');await v.page.locator(area).evaluate(e=>{e.scrollTop=e.scrollHeight;e.scrollIntoView({block:'end'});});}
   const changed=await this.wait(v,async()=>{
    // Opening the pane may briefly render an empty placeholder before its response.
    if(opening&&cap.commentRevision===0&&!(await readZhihuDetailDom(v.page,note))?.comments.length)return false;
    return await snapshot()!==before;
   });
   if(!changed){this.noProgress.add(blocked);throw new Error('暂未读取到新增知乎评论。请刷新正文后重试。');}return this.detailResult(v,note);
  });
 }
 async moreReplies(note:NoteDetail,commentId:string):Promise<NoteDetail>{
  return this.run(async()=>{
   const blocked=contentKey(note)+':reply:'+commentId;if(this.noProgress.has(blocked))throw new Error('暂未读取到新增回复。请刷新正文后重试。');
   const root=note.comments.find(c=>c.id===commentId);if(!root)throw new Error('请选择一条已读取的一级评论');
   const v=await this.detailView(note),cap=v.capture;const hadTarget=cap.comments.some(c=>c.id===commentId);cap.comments=mergeById(cap.comments,[root]);const revision=cap.replyRevisions.get(commentId)||0;
   try{
   const before=JSON.stringify({ids:root.replies.map(c=>c.id),hasMore:root.hasMoreReplies});
   const progress=async()=>{const updated=(cap.replyRevisions.get(commentId)||0)>revision?cap.comments.find(c=>c.id===commentId):(await readZhihuDetailDom(v.page,note))?.comments.find(c=>c.id===commentId);return !!updated&&JSON.stringify({ids:mergeById(root.replies,updated.replies).map(c=>c.id),hasMore:updated.hasMoreReplies})!==before;};
   const selector=await findZhihuReplyButton(v.page,root);if(!selector)throw new Error('暂未找到这条知乎评论的展开按钮。请重新加载一级评论后再试。');
   await v.page.locator(selector).click();const changed=await this.wait(v,progress);
   if(!changed){this.noProgress.add(blocked);throw new Error('暂未读取到新增回复。请刷新正文后重试。');}
   const fromApi=(cap.replyRevisions.get(commentId)||0)>revision,updated=fromApi?cap.comments.find(c=>c.id===commentId):(await readZhihuDetailDom(v.page,note))?.comments.find(c=>c.id===commentId);
   return this.keep(this.notes,contentKey(note),{...note,comments:note.comments.map(c=>c.id===commentId&&updated?{...updated,time:updated.time||c.time,replies:mergeById(c.replies,updated.replies)}:c)},30);
   }finally{if(!hadTarget&&(cap.replyRevisions.get(commentId)||0)===revision)cap.comments=cap.comments.filter(c=>c.id!==commentId);}
  });
 }
 async login():Promise<void>{
  if(this.clearing)throw new Error('正在清除知乎会话');const gen=this.generation+1;await this.close();if(gen!==this.generation)throw new Error('阅读已收起');
  return this.run(async()=>{this.lists.clear();this.notes.clear();this.noProgress.clear();const c=await this.ensure(true),p=c.pages()[0]||await c.newPage();
   try{await p.goto(this.loginUrl,{waitUntil:'domcontentloaded'});await p.bringToFront();}catch{throw new Error('登录窗口已打开，但知乎尚未载入。请在窗口中检查网络。');}
   try{await this.savePause(false);this.paused=false;}catch{await c.close().catch(()=>undefined);throw new Error('无法保存知乎联网恢复状态，请重试登录。');}
  },true,false);
 }
 async close():Promise<void>{this.generation++;const c=this.context;this.context=undefined;this.mode=undefined;this.views.forEach(v=>v.dispose());this.views.clear();await c?.close().catch(()=>undefined);await this.stopping;await this.tail.catch(()=>undefined);await this.pauseWrites.catch(()=>undefined);}
 async clear():Promise<void>{if(this.clearing)throw new Error('正在清除知乎会话');this.clearing=true;try{await this.close();this.lists.clear();this.notes.clear();this.noProgress.clear();this.active=undefined;this.question=undefined;this.query='';this.loginUrl='https://www.zhihu.com/';await rm(this.profile,{recursive:true,force:true});}finally{this.clearing=false;}}
}
