import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import {ReaderBrowser} from '../../src/browser';
import {ZhihuReader} from '../../src/zhihu/reader';
const until=async(check:()=>boolean)=>{for(let i=0;i<60;i++){if(check())return;await new Promise(r=>setTimeout(r,50));}assert.ok(check(),'expected host UI state did not arrive');};
export async function run():Promise<void> {
  // Isolate the real native UI from the live account/network. Browser reads have separate real-Chrome tests.
  const calls:Array<string|undefined>=[];
  const originalDiscover=ReaderBrowser.prototype.discover,originalDetail=ReaderBrowser.prototype.detail,originalComments=ReaderBrowser.prototype.moreComments,originalMore=ReaderBrowser.prototype.moreDiscover,originalReplies=ReaderBrowser.prototype.moreReplies;
  let releaseComments!:()=>void;
  const pendingComments=new Promise<void>(resolve=>{releaseComments=resolve;});
  let commentCalls=0;
  const channels=[{id:'homefeed_recommend',name:'推荐'},{id:'homefeed.food_v3',name:'美食'}];
  ReaderBrowser.prototype.discover=async function(id){
    calls.push(id);const channel=channels.find(c=>c.id===id)||channels[0];
    return {channel,channels,notes:[{id:'a',title:'原生界面测试笔记',author:'测试',likes:'1',url:'https://www.xiaohongshu.com/explore/a'}],hasMore:false,status:'已载入 1 条'};
  };
  ReaderBrowser.prototype.detail=async function(note){return {...note,time:'2026-10-09 08:30',text:'正文测试\n'.repeat(80),comments:[],commentStatus:'无更多评论'};};
  ReaderBrowser.prototype.moreComments=async function(note){commentCalls++;assert.ok(note);await pendingComments;return {...note,time:'2026-10-09 08:30',text:'正文测试\n'.repeat(80),comments:[{id:'c',time:'2026-10-09 09:00',text:'异步评论',author:'测试',likes:'',replies:[],hasMoreReplies:true}],commentHasMore:true,commentStatus:'可继续加载一级评论'};};
  let replyTarget='';
  ReaderBrowser.prototype.moreReplies=async function(note,id){replyTarget=id;return {...note,comments:note.comments.map(c=>c.id===id?{...c,hasMoreReplies:false,replies:[{id:'r',time:'2026-10-09 09:01',text:'指定评论的回复',author:'回复者',likes:'',replies:[],hasMoreReplies:false}]}:c)};};
  try {
    const extension=vscode.extensions.getExtension('local-margin.margin-notes');
    assert.ok(extension,'extension registered');await extension.activate();
    const commands=await vscode.commands.getCommands(true);
    for(const name of ['open','discover','channels','search','resume','hide','login','finishLogin','moreComments','results','clearSession'])assert.ok(commands.includes('margin.'+name),name);
    await vscode.commands.executeCommand('margin.resume');assert.deepEqual(calls,[undefined],'first open must load recommendation');
    await vscode.commands.executeCommand('margin.channels');
    await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext');
    await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
    await until(()=>calls.length===2);assert.equal(calls[1],'homefeed.food_v3','category selection must load selected feed');
    // Native quick-pick acceptance opens the note through the actual extension command flow.
    await new Promise(r=>setTimeout(r,100));
    await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
    await until(()=>vscode.window.activeTextEditor?.document.uri.scheme==='margin');
    const editor=vscode.window.activeTextEditor;assert.ok(editor);assert.equal(editor.document.languageId,'margin-text');
    assert.match(editor.document.getText(),/原生界面测试笔记/);assert.match(editor.document.getText(),/2026-10-09 08:30/);
    assert.ok(!editor.document.getText().includes('异步评论'),'body must open while comments are pending');
    await new Promise(r=>setTimeout(r,150));assert.equal(commentCalls,0,'opening a note must not automatically load comments');
    releaseComments();await vscode.commands.executeCommand('margin.moreComments','a');await until(()=>editor.document.getText().includes('异步评论'));assert.match(editor.document.getText(),/2026-10-09 09:00/);
    const lenses=await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider',editor.document.uri);
    const roots=lenses.find(l=>l.command?.command==='margin.moreComments');
    const replies=lenses.find(l=>l.command?.command==='margin.moreReplies');
    assert.ok(roots&&replies);assert.ok(roots.range.start.line>replies.range.start.line&&replies.range.start.line>0,'comment actions belong after their content, not the top toolbar');
    assert.deepEqual(replies.command?.arguments,['a','c','xiaohongshu','note']);
    editor.revealRange(new vscode.Range(40,0,40,0),vscode.TextEditorRevealType.AtTop);
    await new Promise(r=>setTimeout(r,100));const readingLine=editor.visibleRanges[0].start.line;
    await vscode.commands.executeCommand(replies.command!.command,...replies.command!.arguments!);
    await until(()=>editor.document.getText().includes('指定评论的回复'));assert.equal(replyTarget,'c');assert.match(editor.document.getText(),/2026-10-09 09:01/);
    assert.ok(Math.abs(editor.visibleRanges[0].start.line-readingLine)<=1,'expanding replies preserves reading position');
    const afterReply=await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider',editor.document.uri);
    assert.ok(!afterReply.some(l=>l.command?.command==='margin.moreReplies'),'fully loaded reply action disappears');
    const before=editor.document.getText();await vscode.commands.executeCommand('type',{text:'injected'});
    assert.equal(editor.document.getText(),before,'user typing must not modify the virtual document');
    await vscode.commands.executeCommand('margin.hide');
    assert.ok(!vscode.window.tabGroups.all.flatMap(g=>g.tabs).some(t=>t.input instanceof vscode.TabInputText&&t.input.uri.scheme==='margin'));
    await vscode.commands.executeCommand('margin.resume');assert.equal(vscode.window.activeTextEditor?.document.uri.scheme,'margin');assert.equal(calls.length,2,'resume note should not refresh recommendations');
    await vscode.commands.executeCommand('margin.results');await vscode.commands.executeCommand('margin.hide');
    await vscode.commands.executeCommand('margin.resume');assert.equal(calls.length,2,'resume list should not refetch');
    await vscode.commands.executeCommand('margin.open');assert.equal(calls.at(-1),undefined,'explicit open returns to recommendation');
    await vscode.commands.executeCommand('margin.hide');
    const notes=Array.from({length:32},(_,i)=>({id:String(i),title:'分页帖子 '+i,author:'测试',likes:'1',url:'https://www.xiaohongshu.com/explore/'+i}));
    let moreCalls=0,openedId='';
    ReaderBrowser.prototype.discover=async()=>({channel:channels[0],channels,notes:notes.slice(0,30),hasMore:true,status:'30 条'});
    ReaderBrowser.prototype.moreDiscover=async()=>{moreCalls++;return {channel:channels[0],channels,notes,hasMore:true,status:'32 条'};};
    ReaderBrowser.prototype.detail=async(note)=>{openedId=note.id;return {...note,text:'分页正文',comments:[],commentStatus:'已加载网站返回的全部评论'};};
    await vscode.commands.executeCommand('margin.open');
    await vscode.commands.executeCommand('quickInput.last');
    await vscode.commands.executeCommand('quickInput.accept');
    await until(()=>moreCalls===1);await new Promise(r=>setTimeout(r,150));
    await vscode.commands.executeCommand('quickInput.accept');
    await until(()=>openedId!=='');assert.equal(openedId,'30','load more must focus the first new note, not the top of the list');
    await vscode.commands.executeCommand('margin.hide');
    // A temporary focus change (for example Chrome starting) must not cancel a refresh.
    let releaseRefresh!:(value:any)=>void;
    ReaderBrowser.prototype.discover=()=>new Promise(resolve=>{releaseRefresh=resolve;});
    openedId='';
    const refreshing=vscode.commands.executeCommand('margin.discover');
    await until(()=>!!releaseRefresh);
    const backgroundDoc=await vscode.workspace.openTextDocument({content:'focus regression background'});
    await vscode.window.showTextDocument(backgroundDoc,{preserveFocus:false});
    await new Promise(r=>setTimeout(r,150));
    releaseRefresh({channel:channels[0],channels,notes:[notes[0]],hasMore:false,status:'1 条'});
    await refreshing;await new Promise(r=>setTimeout(r,150));
    await vscode.commands.executeCommand('quickInput.accept');
    await until(()=>openedId==='0');
    await vscode.commands.executeCommand('margin.hide');
    ReaderBrowser.prototype.discover=async()=>({channel:channels[0],channels,notes:notes.slice(0,30),hasMore:true,status:'30 条'});
    await runZhihuHost();
    console.log('Margin host checks passed: default recommendation, category selection, note opening, read-only typing, source list return, hide and restore.');
  }finally{releaseComments();ReaderBrowser.prototype.discover=originalDiscover;ReaderBrowser.prototype.detail=originalDetail;ReaderBrowser.prototype.moreComments=originalComments;ReaderBrowser.prototype.moreDiscover=originalMore;ReaderBrowser.prototype.moreReplies=originalReplies;}
}

async function runZhihuHost():Promise<void>{
 const originals={discover:ZhihuReader.prototype.discover,answers:ZhihuReader.prototype.answers,detail:ZhihuReader.prototype.detail,moreComments:ZhihuReader.prototype.moreComments,close:ZhihuReader.prototype.close};
 let discovers=0,answerLoads=0,commentLoads=0,xhsClears=0,zhihuClears=0;
 const originalXhsClear=ReaderBrowser.prototype.clear,originalZhihuClear=ZhihuReader.prototype.clear;
 ReaderBrowser.prototype.clear=async()=>{xhsClears++;};ZhihuReader.prototype.clear=async()=>{zhihuClears++;};
 const q={id:'10',platform:'zhihu' as const,kind:'question' as const,title:'知乎问题测试',author:'',likes:'',url:'https://www.zhihu.com/question/10'};
 const a={id:'11',platform:'zhihu' as const,kind:'answer' as const,questionId:'10',title:q.title,author:'知乎作者',likes:'2',url:'https://www.zhihu.com/question/10/answer/11'};
 ZhihuReader.prototype.discover=async()=>{discovers++;return {channel:{id:'recommend',name:'首页推荐'},channels:[{id:'recommend',name:'首页推荐'}],notes:[q],hasMore:false,status:'1 条'};};
 ZhihuReader.prototype.answers=async()=>{answerLoads++;return {notes:[a],hasMore:false,status:'1 条回答'};};
 ZhihuReader.prototype.detail=async n=>({...n,time:'2026-10-10 10:00',updatedTime:'2026-10-10 11:00',text:'知乎回答正文',comments:[],commentHasMore:true,commentStatus:'尚未加载'});
 ZhihuReader.prototype.moreComments=async n=>{commentLoads++;return {...n!,text:'知乎回答正文',comments:[],commentHasMore:false,commentStatus:'全部加载'};};
 try{
  assert.ok((await vscode.commands.getCommands(true)).includes('margin.platform'),'platform command is registered');
  await vscode.commands.executeCommand('margin.resume');
  await Promise.all([vscode.commands.executeCommand('margin.clearSession'),vscode.commands.executeCommand('margin.platform','zhihu')]);
  assert.equal(xhsClears,1,'clear targets the platform captured before switching');assert.equal(zhihuClears,0,'switching must not clear the new platform');
  await vscode.commands.executeCommand('margin.platform','zhihu');assert.equal(discovers,1);
  await vscode.commands.executeCommand('quickInput.accept');await until(()=>answerLoads===1);
  await new Promise(r=>setTimeout(r,100));await vscode.commands.executeCommand('quickInput.accept');
  await until(()=>vscode.window.activeTextEditor?.document.getText().includes('知乎回答正文')===true);
  const e=vscode.window.activeTextEditor!;assert.match(e.document.getText(),/编辑于.*2026-10-10 11:00/);
  const lenses=await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider',e.document.uri);
  assert.ok(lenses.some(l=>l.command?.command==='margin.platform'));assert.ok(!lenses.some(l=>l.command?.command==='margin.channels'));
  const comments=lenses.find(l=>l.command?.command==='margin.moreComments')!;assert.deepEqual(comments.command?.arguments,['11','zhihu','answer']);
  await vscode.commands.executeCommand('margin.moreComments','11','xiaohongshu','note');assert.equal(commentLoads,0,'old platform actions must be inert');
  await vscode.commands.executeCommand('margin.results');await vscode.commands.executeCommand('quickInput.accept');await until(()=>vscode.window.activeTextEditor?.document.getText().includes('知乎回答正文')===true);assert.equal(answerLoads,1,'return uses cached answer list');
  await vscode.commands.executeCommand('margin.sourceResults');await vscode.commands.executeCommand('quickInput.accept');await until(()=>answerLoads===2);
  await vscode.commands.executeCommand('margin.hide');await vscode.commands.executeCommand('margin.platform','xiaohongshu');await vscode.commands.executeCommand('margin.hide');await vscode.commands.executeCommand('margin.platform','zhihu');assert.equal(discovers,1,'platform switching restores cached recommendation');
  const pausedMessage='知乎联网已暂停：网站要求验证或限制了访问。请稍后主动运行 Margin: 登录 / 处理验证；重载或刷新不会自动重试。';
  ZhihuReader.prototype.discover=async()=>{throw new Error(pausedMessage);};
  // An inline failure must be readable even when extension notifications are muted.
  void vscode.commands.executeCommand('margin.discover');
  await until(()=>vscode.window.activeTextEditor?.document.getText().includes(pausedMessage)===true);
  const failureLenses=await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider',vscode.window.activeTextEditor!.document.uri);
  assert.ok(failureLenses.some(l=>l.command?.command==='margin.login'),'paused reading has an explicit recovery action');
  await vscode.commands.executeCommand('margin.hide');await vscode.commands.executeCommand('margin.platform','xiaohongshu');await vscode.commands.executeCommand('margin.hide');
 }finally{Object.assign(ZhihuReader.prototype,originals);ReaderBrowser.prototype.clear=originalXhsClear;ZhihuReader.prototype.clear=originalZhihuClear;}
}
