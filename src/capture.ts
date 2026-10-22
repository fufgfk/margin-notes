import { allowedHost, Comment, mergeById, mergeReplies, NoteDetail, NoteSummary, parseComments, parseDetail, parseSearch } from './model';
export function requestAllowed(input:string,type:string,login:boolean):boolean {
  try { const u=new URL(input); return u.protocol==='https:' && !u.username && !u.password && !u.port && allowedHost(u.hostname); } catch { return false; }
}
export function classifyPage(url:string,text:string):string|undefined {
  if(url.includes('error_code=300012') || /IP存在风险|IP 存在风险/.test(text)) return '小红书限制了当前会话（300012：IP 存在风险）。可尝试 Margin: 登录 / 处理验证；若仍受限，请稍后重试或切换可靠网络。';
  if(url.includes('/website-login/error')) return '小红书限制了当前会话。请使用 Margin: 登录 / 处理验证 查看官网说明。';
  if(/请完成安全验证|拖动滑块完成拼图|请完成下方验证/.test(text)) return '小红书要求人工验证。请使用 Margin: 登录 / 处理验证，在官方窗口完成后重试。';
}
export class Capture {
  notes:NoteSummary[]=[];
  detail?:NoteDetail;
  comments:Comment[]=[];
  searchHasMore:boolean|undefined;
  commentHasMore:boolean|undefined;
  apiError?:string;
  revision=0;
  commentRevision=0;
  replyRevisions=new Map<string,number>();
  constructor(readonly kind:'search'|'detail'|'discover',readonly noteId='', readonly channelId?:string){}
  accept(input:string,json:unknown,requestCategory?:string):void {
    let url:URL; try { url=new URL(input); } catch { return; }
    if(url.protocol!=='https:' || !['www.xiaohongshu.com','edith.xiaohongshu.com','so.xiaohongshu.com'].includes(url.hostname)) return;
    if(!json || typeof json!=='object') return;
    const value=json as {success?:boolean;code?:number;data?:{has_more?:boolean}};
    if(!url.pathname.startsWith('/api/sns/web/')) return;
    const homefeed=/\/homefeed$/.test(url.pathname), search=/\/search\/notes$/.test(url.pathname), feed=/\/feed$/.test(url.pathname), comment=/\/comment\/(?:sub\/)?page$/.test(url.pathname);
    if(!(this.kind==='discover'?homefeed:this.kind==='search'?search:feed||comment)) return;
    if(homefeed && this.channelId && requestCategory!==this.channelId) return;
    if(comment && url.searchParams.get('note_id')!==this.noteId) return;
    if(value.success===false) { this.apiError='网站接口未返回可读数据。请检查登录、验证状态后重试。'; return; }
    this.apiError=undefined;
    if(search||homefeed) { this.notes=mergeById(this.notes,parseSearch(json,homefeed?'pc_feed':'pc_search')).slice(0,500); if(typeof value.data?.has_more==='boolean') this.searchHasMore=value.data.has_more; }
    if(feed) { const d=parseDetail(json,this.noteId); if(d) this.detail=d; }
    if(comment) {
      this.commentRevision++;
      const comments=parseComments(json), hasMore=value.data?.has_more;
      if(url.pathname.includes('/sub/')) {
        const rootId=url.searchParams.get('root_comment_id')||'';
        this.replyRevisions.set(rootId,(this.replyRevisions.get(rootId)||0)+1);
        this.comments=mergeReplies(this.comments,rootId,comments,hasMore!==false);
      }
      else { this.comments=mergeById(this.comments,comments).slice(0,1000); if(typeof hasMore==='boolean') this.commentHasMore=hasMore; }
    }
    this.revision++;
  }
}
