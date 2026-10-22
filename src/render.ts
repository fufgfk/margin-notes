import { cleanText, Comment, NoteDetail } from './model';
export interface ReadingAction {line:number;kind:'comments'|'replies';commentId?:string;title:string}
// Actions are generated from structured data, never from instructions or links in external text.
export function renderNoteDocument(note:NoteDetail):{text:string;actions:ReadingAction[]} {
  const actions:ReadingAction[]=[];
  const lines=['READING NOTES','─'.repeat(46),'',cleanText(note.title),`${cleanText(note.author)}${note.likes?'  ·  '+cleanText(note.likes)+' 赞':''}${note.time?'  ·  '+cleanText(note.time,100).replace(/\n/g,' '):''}`,...(note.updatedTime?['编辑于 '+cleanText(note.updatedTime,100).replace(/\n/g,' ')]:[]),...(note.accessNotice?[cleanText(note.accessNotice,500)]:[]),'','正文','─'.repeat(24),cleanText(note.text)||'这篇笔记没有可读取的文字。','','评论','─'.repeat(24)].flatMap(s=>s.split('\n'));
  const append=(c:Comment,depth:number)=>{
    const pad='  '.repeat(Math.min(depth,4));
    lines.push(...`${pad}${cleanText(c.author)}${c.likes?' · '+cleanText(c.likes)+' 赞':''}${c.time?' · '+cleanText(c.time,100).replace(/\n/g,' '):''}`.split('\n'));
    lines.push(...cleanText(c.text).split('\n').map(s=>pad+'  '+s));
    for(const child of c.replies)append(child,depth+1);
    if(depth===0 && c.hasMoreReplies){
      actions.push({line:lines.length,kind:'replies',commentId:c.id,title:c.replies.length?'加载更多回复':'展开回复'});
      lines.push(pad+'  ↳ 此评论还有回复');
    }
    lines.push('');
  };
  for(const c of note.comments)append(c,0);
  if(!note.comments.length)lines.push('暂无已读取的评论。','');
  lines.push('─'.repeat(46));
  if(note.commentHasMore!==false)actions.push({line:lines.length,kind:'comments',title:'加载更多评论'});
  lines.push(...cleanText(note.commentStatus).split('\n'),'回复可在对应评论下展开；收起后可恢复当前位置。');
  return {text:lines.join('\n'),actions};
}
export function renderNote(note:NoteDetail):string{return renderNoteDocument(note).text;}
