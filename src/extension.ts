import * as vscode from 'vscode';
import { join } from 'node:path';
import { ReaderBrowser } from './browser';
import { Channel, cleanText, mergeById, NoteSummary } from './model';
import { renderNote, renderNoteDocument } from './render';
import {PlatformState,contentKey} from './platform-state';
import {Platform} from './model';
import {Reader} from './reader';
import {ZhihuReader} from './zhihu/reader';
import {mergeZhihu} from './zhihu/model';

const scheme='margin';
const uri=vscode.Uri.parse('margin:/reading-notes.md');
const welcome=['READING NOTES','──────────────────────────────────────────────','','Margin · 边栏笔记','','先运行「Margin: 登录 / 处理验证」，在独立浏览器中登录当前平台。','登录完成后运行「Margin: 完成登录并关闭浏览器」。','','打开推荐：macOS ⌘⌥M   / Windows、Linux Ctrl+Alt+M','使用「Margin: 切换平台」选择小红书或知乎；列表右上角可刷新或搜索。','搜索：macOS ⌘⌥;   / Windows、Linux Ctrl+Alt+;','收起：macOS ⌘⌥.   / Windows、Linux Ctrl+Alt+.','恢复：macOS ⌘⌥,   / Windows、Linux Ctrl+Alt+,','','阅读界面只显示文字。顶部可返回列表或刷新正文，评论末尾可加载更多。','每条评论下可单独展开回复；需开启编辑器 CodeLens。','','会话保存在本机专用浏览器目录，不读取日常浏览器数据。','需要退出账号时，运行「Margin: 清除登录和阅读会话」。','','默认使用有窗口 Chrome，并尝试最小化；启动时仍可能短暂显示。','遇到网站限制会停止联网，重载后仍暂停；稍后主动使用登录命令查看官网提示。'].join('\n');
let readers:Reader[]=[];
interface Item extends vscode.QuickPickItem {note?:NoteSummary;more?:boolean;channel?:Channel}
export function activate(context:vscode.ExtensionContext):void {
  const saved=context.globalState.get<string>('activePlatform','xiaohongshu');
  const platforms=new PlatformState(saved==='zhihu'?'zhihu':'xiaohongshu');
  let state=platforms.state();
  const current=(ticket:number)=>platforms.current(ticket,platforms.platform);
  const platformName=()=>platforms.platform==='zhihu'?'知乎':'小红书';
  const change=new vscode.EventEmitter<vscode.Uri>();
  const lensChange=new vscode.EventEmitter<void>();
  const config=()=>{
    const c=vscode.workspace.getConfiguration('margin');
    // Never execute a path supplied by a repository's .vscode/settings.json.
    const path=c.inspect<string>('browserPath');const headless=c.inspect<boolean>('headless');
    const background=c.inspect<boolean>('backgroundWindow');
    return {executablePath:path?.globalValue||undefined,headless:headless?.globalValue??false,backgroundWindow:background?.globalValue??true};
  };
  const xhs=new ReaderBrowser(join(context.globalStorageUri.fsPath,'browser-profile'),config,undefined,{
    paused:context.globalState.get<boolean>('networkPaused',false),
    save:async value=>{await context.globalState.update('networkPaused',value);}
  });
  const zhihu=new ZhihuReader(join(context.globalStorageUri.fsPath,'zhihu-browser-profile'),config,undefined,{paused:context.globalState.get<boolean>('networkPaused.zhihu',false),save:async value=>{await context.globalState.update('networkPaused.zhihu',value);}});
  const byPlatform:Record<Platform,Reader>={xiaohongshu:xhs,zhihu};
  readers=[xhs,zhihu];let browser=byPlatform[platforms.platform];
  let picker:vscode.QuickPick<Item>|undefined,input:vscode.InputBox|undefined;
  let position:vscode.Range|undefined,selection:vscode.Selection|undefined;
  let previous:vscode.TextEditor|undefined;
  let loadingComments:{ticket:number;key:string}|undefined;
  let readingFailure:{message:string;needsLogin:boolean}|undefined;
  const content=()=>{
    const text=state.note?renderNote(state.note):welcome;
    return readingFailure?`${text}\n\n──────────────────────────────────────────────\n读取未完成\n${readingFailure.message}\n${readingFailure.needsLogin?'使用此处「登录 / 处理验证」查看官网提示；完成后关闭登录浏览器。':''}`:text;
  };
  const refresh=()=>{change.fire(uri);lensChange.fire();};
  const closeInputs=()=>{const p=picker;picker=undefined;p?.dispose();const i=input;input=undefined;i?.dispose();};
  const closeTabs=async()=>{
    const tabs=vscode.window.tabGroups.all.flatMap(g=>g.tabs).filter(t=>t.input instanceof vscode.TabInputText && t.input.uri.scheme===scheme);
    if(tabs.length) await vscode.window.tabGroups.close(tabs,true);
  };
  const remember=()=>{const e=vscode.window.activeTextEditor;if(e?.document.uri.scheme===scheme){position=e.visibleRanges[0];selection=e.selection;}else if(e){previous=e;}};
  const show=async(ticket:number)=>{
    if(!current(ticket))return;
    refresh();
    const doc=await vscode.workspace.openTextDocument(uri);
    if(!current(ticket))return;
    await vscode.languages.setTextDocumentLanguage(doc,'margin-text');
    if(!current(ticket))return;
    const editor=await vscode.window.showTextDocument(doc,{preview:false,preserveFocus:false});
    if(!current(ticket)){await closeTabs();return;}
    // These options only affect this editor, never the user's global settings.
    editor.options={...editor.options,lineNumbers:vscode.TextEditorLineNumbersStyle.Off};
    if(selection)editor.selection=selection;
    if(position)editor.revealRange(position,vscode.TextEditorRevealType.AtTop);
    if(readingFailure)editor.revealRange(new vscode.Range((state.note?renderNote(state.note):welcome).split('\n').length+1,0,(state.note?renderNote(state.note):welcome).split('\n').length+1,0),vscode.TextEditorRevealType.InCenter);
  };
  const error=async(err:unknown,ticket:number)=>{
    if(!current(ticket))return;
    // Browser/library diagnostics may contain URLs or tokens; expose only our curated errors.
    const message=err instanceof Error?err.message:'';
    const safe=/^(知乎|小红书|需要登录|登录窗口|无法|未找到|暂未|请|网站接口|阅读已收起|正在清除)/.test(message)?cleanText(message,400):'读取未完成。请检查网络或登录状态后重试。';
    const needsLogin=/(?:小红书|知乎)联网已暂停|需要登录|人工验证|安全验证|登录失效|网站接口|300012/.test(safe);
    closeInputs();readingFailure={message:safe,needsLogin};await show(ticket);
    if(!current(ticket))return;
    // The document remains readable when notifications are muted or left unanswered.
    void vscode.window.showWarningMessage(safe,...(needsLogin?['登录 / 处理验证']:[])).then(action=>{
      if(action && current(ticket))void vscode.commands.executeCommand('margin.login');
    });
  };
  const loadNote=async(note:NoteSummary,force=false)=>{
    if(note.platform==='zhihu'&&note.kind==='question')return runAnswers(note,force);
    const ticket=platforms.begin();closeInputs();remember();
    try {
      const value=await vscode.window.withProgress({location:vscode.ProgressLocation.Window,title:'读取'+platformName()+'正文'},()=>browser.detail(note,force));
      if(!current(ticket))return;
      readingFailure=undefined;state.note=value;state.lastView='note';position=undefined;selection=undefined;await show(ticket);
    }catch(e){await error(e,ticket);}
  };
  const results=(ticket:number,status='')=>{
    if(!current(ticket))return;
    readingFailure=undefined;refresh();
    closeInputs();
    const p=vscode.window.createQuickPick<Item>();picker=p;
    p.keepScrollPosition=true;
    // Background Chrome can briefly take focus while navigating. Only an explicit
    // dismissal should hide reading and cancel the pending result.
    p.ignoreFocusOut=true;
    state.lastView='list';
    p.title=state.listMode==='answers'?`知乎 · 回答 · ${cleanText(state.question?.title,70)}`:state.source==='discover'?`${platformName()} · ${state.channel?.name||'推荐'}`:`${platformName()} · 搜索 · ${cleanText(state.query,80)}`;p.placeholder=status||'输入文字筛选已载入结果，回车阅读';p.matchOnDescription=true;p.matchOnDetail=true;
    const listNotes=()=>state.listMode==='answers'?state.answerResults:state.results;
    const listMore=()=>state.listMode==='answers'?state.answerHasMore:state.hasMoreList;
    const fill=(hasMore=true)=>{
      p.items=[...listNotes().map(n=>({label:cleanText(n.title,200).replace(/\n/g,' '),description:[n.kind==='question'?'问题':n.kind==='answer'?'回答':n.kind==='article'?'文章':'',cleanText(n.author,80)].filter(Boolean).join(' · '),detail:n.likes?`${n.likes} 赞`:undefined,note:n})),...(hasMore?[{label:'$(ellipsis) 加载更多结果',more:true}]:[])];
    };
    const channelsButton={iconPath:new vscode.ThemeIcon('list-selection'),tooltip:'切换发现栏目'};
    const refreshButton={iconPath:new vscode.ThemeIcon('refresh'),tooltip:'刷新当前列表'};
    const searchButton={iconPath:new vscode.ThemeIcon('search'),tooltip:'搜索笔记'};
    const discoverButton={iconPath:new vscode.ThemeIcon('home'),tooltip:'发现 · 推荐'};
    const platformButton={iconPath:new vscode.ThemeIcon('arrow-swap'),tooltip:'切换平台'};
    const backButton={iconPath:new vscode.ThemeIcon('arrow-left'),tooltip:'返回推荐 / 搜索列表'};
    p.buttons=state.listMode==='answers'?[backButton,refreshButton,platformButton]:state.source==='discover'?[...(platforms.platform==='xiaohongshu'?[channelsButton]:[]),refreshButton,searchButton,platformButton]:[discoverButton,refreshButton,platformButton];
    fill(listMore());
    const subscriptions:vscode.Disposable[]=[];
    subscriptions.push(p.onDidHide(()=>{if(picker===p){picker=undefined;state.hide();platforms.begin();}subscriptions.forEach(d=>d.dispose());p.dispose();}));
    subscriptions.push(p.onDidTriggerButton(button=>{
      if(p.busy)return;
      if(button===platformButton)void vscode.commands.executeCommand('margin.platform');
      else if(button===backButton)void vscode.commands.executeCommand('margin.sourceResults');
      else if(button===channelsButton)void chooseChannel();
      else if(button===discoverButton)void runDiscover();
      else if(button===searchButton)void vscode.commands.executeCommand('margin.search');
      else if(button===refreshButton){if(state.listMode==='answers'&&state.question)void runAnswers(state.question,true);else if(state.source==='discover')void runDiscover(state.channel?.id,true);else void runSearch(state.query,platforms.begin(),true);}
    }));
    subscriptions.push(p.onDidAccept(async()=>{
      if(p.busy)return;
      const item=p.selectedItems[0];if(!item)return;
      if(item.note){picker=undefined;p.hide();await loadNote(item.note);return;}
      if(item.more){
        p.busy=true;p.enabled=false;
        const previousIds=new Set(listNotes().map(contentKey));
        try {
          const r=await (state.listMode==='answers'?browser.moreAnswers!():state.source==='discover'?browser.moreDiscover():browser.moreSearch());
          if(!current(ticket)||picker!==p)return;
          if(state.listMode==='answers'){state.answerResults=mergeZhihu(state.answerResults,r.notes);state.answerHasMore=r.hasMore;}else {state.results=platforms.platform==='zhihu'?mergeZhihu(state.results,r.notes):mergeById(state.results,r.notes).slice(0,500);state.hasMoreList=r.hasMore;}
          fill(r.hasMore);
          const next=p.items.find(i=>i.note&&!previousIds.has(contentKey(i.note)))||p.items.find(i=>i.more)||p.items.at(-1);
          if(next)p.activeItems=[next];
          p.placeholder=r.status;
        }
        catch(e){await error(e,ticket);}finally{if(picker===p){p.busy=false;p.enabled=true;}}
      }
    }));
    p.show();
  };
  const runSearch=async(query:string,ticket:number,force=false)=>{
    if(!current(ticket))return;
    state.resetList('search',query);state.hasMoreList=true;
    results(ticket,'正在搜索…');const p=picker;if(p){p.busy=true;p.enabled=false;}
    try {
      const r=await browser.search(query,force);if(!current(ticket))return;
      state.results=r.notes;state.listReady=true;state.hasMoreList=r.hasMore;results(ticket,r.status);
    }catch(e){if(current(ticket)){closeInputs();await error(e,ticket);}}
  };
  const runDiscover=async(channelId?:string,force=false)=>{
    const ticket=platforms.begin();closeInputs();remember();
    state.resetList('discover');state.channel=state.channels.find(c=>c.id===channelId);state.hasMoreList=true;
    results(ticket,'正在读取发现内容…');const p=picker;if(p){p.busy=true;p.enabled=false;}
    try {
      const r=await browser.discover(channelId,force);if(!current(ticket))return;
      state.channel=r.channel;state.channels=r.channels;state.results=r.notes;state.listReady=true;state.hasMoreList=r.hasMore;
      results(ticket,r.status);
    }catch(e){if(current(ticket)){closeInputs();await error(e,ticket);}}
  };
  const runAnswers=async(question:NoteSummary,force=false)=>{
    const ticket=platforms.begin();closeInputs();remember();
    state.question=question;state.listMode='answers';state.answerResults=[];state.answerHasMore=true;
    results(ticket,'正在读取回答…');const p=picker;if(p){p.busy=true;p.enabled=false;}
    try{const r=await browser.answers!(question,force);if(!current(ticket))return;state.answerResults=r.notes;state.answerHasMore=r.hasMore;state.listReady=true;results(ticket,r.status);}catch(e){if(current(ticket)){closeInputs();await error(e,ticket);}}
  };
  const chooseChannel=async()=>{
    if(platforms.platform==='zhihu')return runDiscover();
    const ticket=platforms.begin();closeInputs();remember();
    try {
      if(!state.channels.length){
        const r=await vscode.window.withProgress({location:vscode.ProgressLocation.Window,title:'读取发现栏目'},()=>browser.discover());
        if(!current(ticket))return;state.channels=r.channels;
      }
      const p=vscode.window.createQuickPick<Item>();picker=p;
      p.title='发现 · 切换栏目';p.placeholder='选择官网栏目，回车打开';
      p.items=state.channels.map(c=>({label:c.name,description:state.source==='discover'&&state.channel?.id===c.id?'当前栏目':undefined,channel:c}));
      const ds:vscode.Disposable[]=[];
      ds.push(p.onDidHide(()=>{if(picker===p){picker=undefined;state.hide();platforms.begin();}ds.forEach(d=>d.dispose());p.dispose();}));
      ds.push(p.onDidAccept(()=>{const channel=p.selectedItems[0]?.channel;if(!channel)return;picker=undefined;p.hide();void runDiscover(channel.id);}));
      p.show();
    }catch(e){await error(e,ticket);}
  };
  const register=(name:string,fn:(...args:any[])=>unknown)=>context.subscriptions.push(vscode.commands.registerCommand(name,fn));
  context.subscriptions.push(change,lensChange,vscode.workspace.registerTextDocumentContentProvider(scheme,{onDidChange:change.event,provideTextDocumentContent:()=>content()}));
  context.subscriptions.push(vscode.languages.registerCodeLensProvider({scheme},{onDidChangeCodeLenses:lensChange.event,provideCodeLenses:()=>[
    ...(readingFailure?.needsLogin?[new vscode.CodeLens(new vscode.Range((state.note?renderNote(state.note):welcome).split('\n').length+1,0,(state.note?renderNote(state.note):welcome).split('\n').length+1,0),{title:'登录 / 处理验证',command:'margin.login'})]:[]),
    new vscode.CodeLens(new vscode.Range(0,0,0,0),{title:'发现',command:'margin.discover'}),
    ...(platforms.platform==='xiaohongshu'?[new vscode.CodeLens(new vscode.Range(0,0,0,0),{title:'切换栏目',command:'margin.channels'})]:[]),
    new vscode.CodeLens(new vscode.Range(0,0,0,0),{title:'切换平台',command:'margin.platform'}),
    new vscode.CodeLens(new vscode.Range(0,0,0,0),{title:'搜索',command:'margin.search'}),
    new vscode.CodeLens(new vscode.Range(0,0,0,0),{title:'返回列表',command:'margin.results'}),
    ...(state.listMode==='answers'?[new vscode.CodeLens(new vscode.Range(0,0,0,0),{title:'返回推荐 / 搜索',command:'margin.sourceResults'})]:[]),
    ...(state.note?[new vscode.CodeLens(new vscode.Range(0,0,0,0),{title:'刷新正文',command:'margin.refreshNote'})]:[]),

    new vscode.CodeLens(new vscode.Range(0,0,0,0),{title:'收起',command:'margin.hide'}),
    ...(state.note?renderNoteDocument(state.note).actions.map(action=>{
      const busy=loadingComments && current(loadingComments.ticket) && loadingComments.key===(action.commentId||'roots');
      return new vscode.CodeLens(new vscode.Range(action.line,0,action.line,0),{
        title:busy?'加载中…':action.title,command:busy?'':action.kind==='comments'?'margin.moreComments':'margin.moreReplies',
        arguments:action.kind==='comments'?[state.note!.id,platforms.platform,state.note!.kind||'note']:[state.note!.id,action.commentId,platforms.platform,state.note!.kind||'note']
      });
    }):[])
  ]}));
  const readingPositions=new Map<Platform,{position?:vscode.Range;selection?:vscode.Selection}>();
  const switchPlatform=async(target:Platform)=>{
    if(target===platforms.platform){const ticket=platforms.begin();if(state.resumeTarget==='note')await show(ticket);else if(state.listReady)results(ticket);else await runDiscover();return;}
    remember();readingPositions.set(platforms.platform,{position,selection});closeInputs();
    const old=browser;platforms.select(target);state=platforms.state();browser=byPlatform[target];
    readingFailure=undefined;
    position=readingPositions.get(target)?.position;selection=readingPositions.get(target)?.selection;loadingComments=undefined;
    const ticket=platforms.begin();refresh();await closeTabs();await old.close().catch(()=>undefined);if(!current(ticket))return;
    await context.globalState.update('activePlatform',target);if(!current(ticket))return;
    if(state.resumeTarget==='note')await show(ticket);else if(state.listReady)results(ticket);else await runDiscover();
  };
  register('margin.platform',async(target?:Platform)=>{
    if(target==='zhihu'||target==='xiaohongshu')return switchPlatform(target);
    const ticket=platforms.begin();closeInputs();remember();
    const picked=await vscode.window.showQuickPick([{label:'小红书',platform:'xiaohongshu' as const},{label:'知乎',platform:'zhihu' as const}],{title:'Margin · 切换平台',placeHolder:'选择阅读平台'});
    if(picked&&current(ticket))await switchPlatform(picked.platform);
  });
  register('margin.sourceResults',()=>{const ticket=platforms.begin();remember();state.listMode='source';if(state.results.length||state.listReady)results(ticket);else return runDiscover();});
  register('margin.open',()=>runDiscover());
  register('margin.discover',()=>runDiscover());
  register('margin.refreshNote',()=>{if(state.note)return loadNote(state.note,true);});
  register('margin.channels',()=>chooseChannel());
  register('margin.search',()=>{
    const ticket=platforms.begin();closeInputs();remember();
    const box=vscode.window.createInputBox();input=box;box.title='搜索'+platformName();box.prompt='只读取文字；回车搜索';box.placeholder='输入关键词';box.value='';
    const ds:vscode.Disposable[]=[];
    ds.push(box.onDidHide(()=>{if(input===box){input=undefined;state.hide();platforms.begin();}ds.forEach(d=>d.dispose());box.dispose();}));
    ds.push(box.onDidAccept(()=>{const q=cleanText(box.value,200);if(!q){box.validationMessage='请输入关键词';return;}input=undefined;box.hide();void runSearch(q,ticket);}));box.show();
  });
  register('margin.results',()=>{const ticket=platforms.begin();remember();if(state.listReady)results(ticket);else return runDiscover();});
  register('margin.resume',async()=>{const ticket=platforms.begin();closeInputs();remember();if(state.resumeTarget==='discover')await runDiscover();else if(state.resumeTarget==='list')results(ticket);else await show(ticket);});
  register('margin.hide',async()=>{
    remember();state.hide();platforms.begin();closeInputs();
    const closing=browser.close().catch(()=>undefined);
    await closeTabs();
    if(previous&&!previous.document.isClosed)await vscode.window.showTextDocument(previous.document,{viewColumn:previous.viewColumn,preserveFocus:false});
    await closing;
  });
  register('margin.login',async()=>{
    const ticket=platforms.begin();closeInputs();
    try {await browser.login();if(!current(ticket))return;const action=await vscode.window.showInformationMessage(`请在独立浏览器中完成${platformName()}登录或验证，完成后运行 Margin: 完成登录并关闭浏览器。`,'完成并关闭');if(action && current(ticket))await browser.close();}
    catch(e){await error(e,ticket);}
  });
  register('margin.finishLogin',()=>browser.close());
  const loadComments=async(noteId?:string,commentId?:string,platform?:Platform,kind?:string)=>{
    if(platform&&platform!==platforms.platform||kind&&state.note?.kind!==kind&&!(kind==='note'&&!state.note?.kind))return;
    if(!state.note || (noteId && state.note.id!==noteId) || (loadingComments && current(loadingComments.ticket)))return;
    const original=state.note;
    const ticket=platforms.begin();remember();
    loadingComments={ticket,key:commentId||'roots'};lensChange.fire();
    try {
      const note=await (commentId?browser.moreReplies(original,commentId):browser.moreComments(original));
      if(!current(ticket)||state.note?.id!==note.id)return;
      readingFailure=undefined;state.note={...note,comments:mergeById(state.note.comments,note.comments)};
      const editor=vscode.window.activeTextEditor;
      const range=editor?.document.uri.scheme===scheme?editor.visibleRanges[0]:undefined;
      const selected=editor?.selection;
      await new Promise<void>(resolve=>{
        const done=()=>{clearTimeout(timeout);subscription.dispose();resolve();};
        const subscription=vscode.workspace.onDidChangeTextDocument(e=>{if(e.document.uri.toString()===uri.toString())done();});
        const timeout=setTimeout(done,500);refresh();
      });
      if(range && editor && editor===vscode.window.activeTextEditor && current(ticket)){
        if(selected)editor.selection=selected;editor.revealRange(range,vscode.TextEditorRevealType.AtTop);
      }
    }catch(e){await error(e,ticket);}finally{if(loadingComments?.ticket===ticket){loadingComments=undefined;lensChange.fire();}}
  };
  register('margin.moreComments',(noteId?:string,platform?:Platform,kind?:string)=>loadComments(noteId,undefined,platform,kind));
  register('margin.moreReplies',(noteId:string,commentId:string,platform?:Platform,kind?:string)=>{if(typeof noteId==='string'&&typeof commentId==='string')return loadComments(noteId,commentId,platform,kind);});
  register('margin.clearSession',async()=>{
    const target=browser,name=platformName(),ticket=platforms.begin();state.clear();readingFailure=undefined;closeInputs();position=undefined;selection=undefined;refresh();await closeTabs();
    try {await target.clear();if(current(ticket))void vscode.window.showInformationMessage(`${name}专用登录会话与阅读缓存已清除。`);}catch{if(current(ticket))void vscode.window.showWarningMessage('浏览器已关闭，但会话目录未能完全删除。请关闭所有 Margin 浏览器窗口后重试清除。');}
  });
  context.subscriptions.push({dispose:()=>{platforms.begin();state.clear();closeInputs();for(const r of readers)void r.close().catch(()=>undefined);}});
}
export async function deactivate():Promise<void> {await Promise.all(readers.map(r=>r.close()));readers=[];}
