export interface Channel { id: string; name: string }
export type Platform='xiaohongshu'|'zhihu';
export type ContentKind='note'|'question'|'answer'|'article';
export interface NoteSummary { id: string; title: string; author: string; likes: string; url: string; platform?:Platform; kind?:ContentKind; questionId?:string; updatedTime?:string; accessNotice?:string }
export interface Comment { id: string; author: string; text: string; likes: string; replies: Comment[]; hasMoreReplies: boolean; time?:string }
export interface NoteDetail extends NoteSummary { text: string; comments: Comment[]; commentStatus: string; commentHasMore?:boolean; time?:string }
type Obj = Record<string, any>;
const obj = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export function cleanText(value: unknown, limit = 80000): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, limit).trim();
}
// API timestamps are epoch seconds or milliseconds; do not guess dates from arbitrary text.
function formatTime(value:unknown):string|undefined {
  if(typeof value!=='number' && !(typeof value==='string' && /^\d{10,13}$/.test(value)))return;
  const numeric=Number(value),ms=numeric<1e12?numeric*1000:numeric;
  if(!Number.isFinite(ms) || ms<Date.UTC(2000,0,1) || ms>=Date.UTC(2100,0,1))return;
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
export function allowedHost(host: string): boolean {
  return ['xiaohongshu.com', 'xhscdn.com', 'xhslink.com'].some(d => host === d || host.endsWith('.' + d));
}
export function officialNoteUrl(input: string): string {
  const url = new URL(input, 'https://www.xiaohongshu.com');
  if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com' || url.port || url.username || url.password || !/^\/(explore|search_result)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) throw new Error('只支持小红书官方笔记链接');
  const safe = new URL(url.pathname, 'https://www.xiaohongshu.com');
  for (const name of ['xsec_token','xsec_source']) { const v=url.searchParams.get(name); if(v) safe.searchParams.set(name,v); }
  return safe.href;
}
function makeSummary(id: string, card: Obj, token: unknown, source='pc_search'): NoteSummary | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return;
  const url = new URL(`/explore/${id}`, 'https://www.xiaohongshu.com');
  if(typeof token === 'string' && token) { url.searchParams.set('xsec_token', token); url.searchParams.set('xsec_source',source); }
  return {id, title:cleanText(card.display_title || card.title,500)||'无标题笔记', author:cleanText(obj(card.user).nickname || obj(card.user).nick_name,200)||'匿名', likes:cleanText(obj(card.interact_info).liked_count,30), url:url.href};
}
export function parseSearch(payload: unknown, source='pc_search'): NoteSummary[] {
  const data=obj(obj(payload).data); const result: NoteSummary[]=[];
  for(const item of arr(data.items).slice(0,300)) {
    const it=obj(item), card=obj(it.note_card || it.noteCard);
    if(!Object.keys(card).length) continue;
    const note=makeSummary(String(it.id || card.note_id || ''), card, it.xsec_token || card.xsec_token, source);
    if(note) result.push(note);
  }
  return result;
}
export function parseDetail(payload: unknown, id: string): NoteDetail | undefined {
  const data=obj(obj(payload).data);
  for(const item of arr(data.items)) {
    const it=obj(item), card=obj(it.note_card);
    if(String(card.note_id || it.id || '') !== id) continue;
    const summary=makeSummary(id,card,it.xsec_token);
    if(summary) return {...summary,time:formatTime(card.time)||formatTime(card.create_time)||formatTime(card.createTime),text:cleanText(card.desc),comments:[],commentStatus:'评论尚未加载'};
  }
}
export function parseComments(payload: unknown): Comment[] {
  const parse=(items:unknown,depth:number):Comment[] => arr(items).slice(0,500).flatMap(item=>{
    const it=obj(item), id=cleanText(it.id,100); if(!id) return [];
    return [{id,time:formatTime(it.create_time)||formatTime(it.createTime),author:cleanText(obj(it.user_info).nickname,200)||'匿名',text:cleanText(it.content,20000),likes:cleanText(it.like_count,30),replies:depth<3?parse(it.sub_comments,depth+1):[],hasMoreReplies:it.sub_comment_has_more===true}];
  });
  return parse(obj(obj(payload).data).comments,0);
}
export function mergeById<T extends {id:string}>(old:T[], next:T[]):T[] {
  const map=new Map(old.map(x=>[x.id,x]));
  for(const item of next) {
    const previous=map.get(item.id);
    const updated=previous && 'time' in previous && !('time' in item && item.time)?{...item,time:previous.time}:item;
    if(previous && 'replies' in previous && 'replies' in item) {
      const a=previous as unknown as Comment,b=item as unknown as Comment;
      map.set(item.id,{...updated,replies:mergeById(a.replies,b.replies)});
    } else map.set(item.id,updated);
  }
  return [...map.values()];
}
export function mergeReplies(comments:Comment[], parentId:string, replies:Comment[], hasMore:boolean):Comment[] {
  return comments.map(c=>c.id===parentId?{...c,replies:mergeById(c.replies,replies),hasMoreReplies:hasMore}:{...c,replies:mergeReplies(c.replies,parentId,replies,hasMore)});
}
