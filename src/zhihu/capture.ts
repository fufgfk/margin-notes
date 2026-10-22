import {Comment,NoteDetail,NoteSummary,mergeById,mergeReplies} from '../model';
import {parseZhihuList,parseZhihuComments,parseZhihuDetail,mergeZhihu} from './model';
export type ViewKind='discover'|'search'|'answers'|'detail';
export class ZhihuCapture {
 notes:NoteSummary[]=[];detail?:NoteDetail;comments:Comment[]=[];
 hasMore?:boolean;commentHasMore?:boolean;apiError?:string;schemaError?:string;
 revision=0;commentRevision=0;replyRevisions=new Map<string,number>();
 constructor(readonly kind:ViewKind,readonly content?:NoteSummary){}
 accepts(input:string):boolean {
  let u:URL;try{u=new URL(input);}catch{return false;}
  if(u.protocol!=='https:'||u.hostname!=='www.zhihu.com'||u.port||u.username||u.password)return false;
  const p=u.pathname,n=this.content;
  if(this.kind==='discover')return /^\/api\/v[34]\/.*(?:feed|topstory\/recommend)(?:\/|$)/.test(p);
  if(this.kind==='search')return /^\/api\/v\d+\/search(?:_v\d+)?$/.test(p);
  if(this.kind==='answers')return !!n&&p===`/api/v4/questions/${n.id}/answers`;
  if(!n)return false;
  const type=n.kind==='article'?'articles':'answers';
  return p===`/api/v4/${type}/${n.id}`||p===`/api/v4/comment_v5/${type}/${n.id}/root_comment`||p===`/api/v4/${type}/${n.id}/root_comments`||(/^\/api\/v4\/comment_v5\/comments?\/\d+\/child_comment$/.test(p)&&this.comments.some(c=>c.id===p.split('/').at(-2)));
 }
 accept(input:string,json:unknown):void {
  if(!this.accepts(input)||!json||typeof json!=='object')return;
  const data=json as {error?:unknown};if(data.error){this.apiError='知乎接口未返回可读数据。请在官网检查登录或验证状态。';return;}
  const p=new URL(input).pathname;
  try{
  if(this.kind!=='detail'){const r=parseZhihuList(json);this.notes=mergeZhihu(this.notes,r.notes);this.hasMore=r.hasMore;this.revision++;return;}
  if(/child_comment$/.test(p)){
   const root=p.split('/').at(-2)!;const r=parseZhihuComments(json);this.comments=mergeReplies(this.comments,root,r.comments,r.hasMore);this.replyRevisions.set(root,(this.replyRevisions.get(root)||0)+1);this.commentRevision++;
  }else if(/root_comment(?:s)?$/.test(p)){
   const r=parseZhihuComments(json);this.comments=mergeById(this.comments,r.comments).slice(0,1000);this.commentHasMore=r.hasMore;this.commentRevision++;
  }else{const d=parseZhihuDetail(json,this.content!);if(d)this.detail=d;}
  this.revision++;
  }catch{this.schemaError='暂未识别知乎响应数据，官网结构可能已变化。';}
 }
}
