import {cleanText,Comment,NoteDetail,NoteSummary,mergeById} from '../model';
import {SearchResult} from '../reader';
type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj=>v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const id=(v:unknown):string=>/^\d+$/.test(String(v))?String(v):'';
export function officialZhihuUrl(input:string):string {
 const u=new URL(input,'https://www.zhihu.com');
 const valid=u.hostname==='www.zhihu.com'?/^\/question\/\d+(?:\/answer\/\d+)?\/?$/.test(u.pathname):u.hostname==='zhuanlan.zhihu.com'&&/^\/p\/\d+\/?$/.test(u.pathname);
 if(u.protocol!=='https:'||u.port||u.username||u.password||!valid)throw new Error('只支持知乎官方问题、回答和文章链接');
 return `https://${u.hostname}${u.pathname.replace(/\/$/,'')}`;
}
export function zhihuRequestAllowed(input:string):boolean {
 try{const u=new URL(input);return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&['zhihu.com','zhimg.com'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d));}catch{return false;}
}
export function htmlToText(v:unknown):string {
 if(typeof v!=='string')return '';
 const plain=v.slice(0,500000).replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(p|div|h[1-6]|li|blockquote|pre|tr)>/gi,'\n').replace(/<li\b[^>]*>/gi,'• ').replace(/<[^>]*>/g,'').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,e:string)=>{
  const fixed:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};if(fixed[e.toLowerCase()]!==undefined)return fixed[e.toLowerCase()];
  const n=e.startsWith('#x')||e.startsWith('#X')?parseInt(e.slice(2),16):Number(e.slice(1));return Number.isInteger(n)&&n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
 });
 return cleanText(plain.replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n'));
}
export function zhihuTime(v:unknown):string|undefined {
 const n=typeof v==='number'?v:typeof v==='string'&&/^\d{10,13}$/.test(v)?Number(v):NaN;
 const ms=n<1e12?n*1000:n;if(!Number.isFinite(ms)||ms<Date.UTC(2000,0,1)||ms>=Date.UTC(2100,0,1))return;
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(x=>[x.type,x.value]));
 return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
function summary(value:unknown):NoteSummary|undefined {
 const outer=obj(value);if(/ad|advert/i.test(String(outer.type||''))||outer.is_ad===true||outer.ad_info)return;
 const o=obj(outer.target||outer.object||value),type=o.type;
 if(!['answer','question','article'].includes(String(type)))return;
 const nid=id(o.id);if(!nid)return;
 const q=obj(o.question),qid=id(q.id),kind=type as 'answer'|'question'|'article';if(kind==='answer'&&!qid)return;
 const url=kind==='article'?`https://zhuanlan.zhihu.com/p/${nid}`:`https://www.zhihu.com/question/${kind==='answer'?qid:nid}${kind==='answer'?'/answer/'+nid:''}`;
 return {id:nid,platform:'zhihu',kind,questionId:kind==='answer'?qid:undefined,url,title:htmlToText(kind==='answer'?q.title:o.title)||'无标题内容',author:cleanText(obj(o.author).name,200)||'',likes:cleanText(o.voteup_count||o.like_count,30)};
}
export function mergeZhihu(old:NoteSummary[],next:NoteSummary[]):NoteSummary[] {
 const m=new Map(old.map(n=>[`${n.kind}:${n.id}`,n]));for(const n of next)m.set(`${n.kind}:${n.id}`,n);return [...m.values()].slice(0,500);
}
export function pagingHasMore(payload:unknown,fallback=true):boolean {
 const p=obj(obj(payload).paging);return typeof p.is_end==='boolean'?!p.is_end:typeof obj(payload).has_more==='boolean'?obj(payload).has_more as boolean:fallback;
}
export function parseZhihuList(payload:unknown):SearchResult {
 const p=obj(payload),data=Array.isArray(payload)?payload:Array.isArray(p.data)?p.data:obj(p.data).items;
 if(!Array.isArray(data))throw new Error('暂未识别知乎列表数据，官网结构可能已变化。');
 const notes=mergeZhihu([],data.slice(0,500).flatMap(v=>{const n=summary(v);return n?[n]:[];}));
 return {notes,hasMore:pagingHasMore(payload),status:`已载入 ${notes.length} 条`};
}
export function parseZhihuDetail(payload:unknown,content:NoteSummary):NoteDetail|undefined {
 const root=obj(payload),o=obj(root.data&& !Array.isArray(root.data)?root.data:payload);
 if(id(o.id)!==content.id || (o.type&&o.type!==content.kind))return;
 const s=summary({...o,type:o.type||content.kind})||content;
 const text=htmlToText(o.content)||htmlToText(o.excerpt);
 if(!text&&!o.title)return;
 const preview=!o.content&&!!o.excerpt;
 return {...content,...s,text,time:zhihuTime(o.created_time||o.created),updatedTime:zhihuTime(o.updated_time||o.updated),accessNotice:preview?'当前仅可读取官网提供的摘要；完整内容可能需要登录或付费。':o.is_paid===true?'当前展示官网可访问的付费内容，完整性取决于当前账号权限。':undefined,comments:[],commentHasMore:o.comment_count===0?false:undefined,commentStatus:'评论尚未加载'};
}
export function parseZhihuComments(payload:unknown):{comments:Comment[];hasMore:boolean} {
 const parse=(values:unknown,depth:number):Comment[]=>arr(values).slice(0,500).flatMap(v=>{
  const o=obj(v),cid=id(o.id);if(!cid)return [];
  const a=obj(o.author),member=obj(a.member);const replies=depth<3?parse(o.child_comments||o.reply_comments,depth+1):[];
  const count=Number(o.child_comment_count||0);
  return [{id:cid,author:cleanText(member.name||a.name,200)||'匿名',text:htmlToText(o.content),likes:cleanText(o.like_count,30),time:zhihuTime(o.created_time),replies,hasMoreReplies:count>replies.length||o.child_comment_has_more===true}];
 });
 const root=obj(payload),data=Array.isArray(root.data)?root.data:obj(root.data).comments;if(!Array.isArray(data))throw new Error('暂未识别知乎评论数据，官网结构可能已变化。');return {comments:mergeById([],parse(data,0)),hasMore:pagingHasMore(payload)};
}
