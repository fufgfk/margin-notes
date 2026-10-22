import type {Page} from 'patchright-core';
import {Comment,NoteDetail,NoteSummary,cleanText} from '../model';
import {SearchResult} from '../reader';
import {officialZhihuUrl,mergeZhihu,parseZhihuDetail} from './model';
export async function readZhihuListDom(page:Page):Promise<SearchResult> {
 const raw=await page.evaluate(()=>{
  const text=(e:Element|null)=>e instanceof HTMLElement?e.innerText.trim():e?.textContent?.trim()||'';
  const items=Array.from(document.querySelectorAll('.TopstoryItem,.SearchResult-Card,.List-item,.AnswerItem,article')).filter(e=>!e.closest('[data-ad],.AdvertItem')&&!e.querySelector('.AdvertCard'));
  return items.slice(0,500).flatMap(e=>{
   const urls=Array.from(e.querySelectorAll('a[href],meta[itemprop="url"]')).map(a=>a.getAttribute('href')||a.getAttribute('content')||'');
   const url=urls.find(s=>/\/question\/\d+\/answer\/\d+/.test(s))||urls.find(s=>/\/p\/\d+/.test(s))||urls.find(s=>/\/question\/\d+/.test(s));
   if(!url)return [];
   const anchor=Array.from(e.querySelectorAll('a[href]')).find(a=>a.getAttribute('href')===url);
   return [{url,title:text(e.querySelector('.ContentItem-title,.QuestionItem-title,h2,h1'))||text(anchor||null)||text(document.querySelector('.QuestionHeader-title')),author:text(e.querySelector('.AuthorInfo-name,.UserLink-link')),likes:text(e.querySelector('.VoteButton--up,.VoteButton.is-active'))}];
  });
 });
 const notes=mergeZhihu([],raw.flatMap(n=>{
  try{const url=officialZhihuUrl(n.url),u=new URL(url);const answer=u.pathname.match(/^\/question\/(\d+)\/answer\/(\d+)$/),article=u.pathname.match(/^\/p\/(\d+)$/),question=u.pathname.match(/^\/question\/(\d+)$/);
   return [{id:answer?.[2]||article?.[1]||question![1],kind:answer?'answer' as const:article?'article' as const:'question' as const,platform:'zhihu' as const,questionId:answer?.[1],url,title:cleanText(n.title,500)||'无标题内容',author:cleanText(n.author,200),likes:cleanText(n.likes,30).replace(/^(赞同|赞)\s*/,'')}];
  }catch{return [];}
 }));
 const hasMore=await page.locator('.List-end,.List-footer:has-text("没有更多"),.EmptyState').count()===0;
 return {notes,hasMore,status:`已载入 ${notes.length} 条`};
}
export async function readZhihuDetailDom(page:Page,note:NoteSummary):Promise<NoteDetail|undefined> {
 const raw=await page.evaluate(({nid,kind})=>{
  const text=(e:Element|null)=>e instanceof HTMLElement?e.innerText.trim():e?.textContent?.trim()||'';
  const isAnswer=kind==='answer';
  const candidates=Array.from(document.querySelectorAll(isAnswer?'.AnswerItem':'.Post-Main,.Post-content,article'));
  const card=isAnswer?candidates.find(e=>e.getAttribute('data-aid')===nid||e.getAttribute('data-answer-id')===nid||e.querySelector(`meta[itemprop="url"][content$="/answer/${nid}"]`))||(candidates.length===1&&!candidates[0].hasAttribute('data-aid')&&!candidates[0].hasAttribute('data-answer-id')&&!candidates[0].querySelector('meta[itemprop="url"]')?candidates[0]:undefined):candidates[0];
  const body=card?.querySelector('.RichContent-inner,.RichText,.Post-RichText')||(!isAnswer?document.querySelector('.Post-RichText'):null);
  const initial=document.querySelector('#js-initialData')?.textContent||'';
  if(!card&&!body)return {initial};
  const time=text(card?.querySelector('.ContentItem-time,.Post-Time,time')||null);
  const commentSelector='.CommentItemV2,.CommentItemV3,.CommentItem';
  const area=card?.querySelector('.Comments-container,.CommentsV2,.CommentsV3')||document.querySelector('.Comments-container,.CommentsV2,.CommentsV3')||document.body;
  const ownerSelector='.AnswerItem,.Post-Main,.Post-content,article';
  const owned=(e:Element)=>{const owner=e.closest(ownerSelector);return owner?owner===card||!!card?.contains(e):candidates.length<=1;};
  const visible=(e:Element)=>e.getClientRects().length>0;
  const all=Array.from(area.querySelectorAll(commentSelector)).filter(e=>owned(e)&&visible(e));
  const own=(e:Element,selector:string)=>Array.from(e.querySelectorAll(selector)).find(n=>n.closest(commentSelector)===e)||null;
  const read=(e:Element):any=>{
   const cid=e.getAttribute('data-id')||e.getAttribute('data-comment-id')||e.id.replace(/^comment[-_]/,'');
   return {id:cid,author:text(own(e,'.UserLink-link,.CommentItemV2-meta .UserLink,.CommentItem-meta .UserLink')),text:text(own(e,'.CommentItemV2-content,.CommentItemV3-content,.CommentItem-content')),time:text(own(e,'.CommentItemV2-time,.CommentItemV3-time,.CommentItem-time,time'))||undefined,likes:text(own(e,'.CommentItemV2-likeBtn,.CommentItem-likeBtn')),replies:[],hasMoreReplies:false};
  };
  const groups=Array.from(area.querySelectorAll('.NestComment')).filter(e=>owned(e)&&visible(e)&&!e.parentElement?.closest('.NestComment'));
  const grouped=new Set<Element>(),comments:any[]=[];
  for(const group of groups){const members=all.filter(e=>e.closest('.NestComment')===group);if(!members.length)continue;members.forEach(e=>grouped.add(e));const c=read(members[0]);c.replies=members.slice(1).map(read);c.hasMoreReplies=Array.from(group.querySelectorAll('button,[role="button"]')).some(e=>/展开.*回复|查看.*回复|更多回复/.test(text(e)));comments.push(c);}
  for(const e of all){if(grouped.has(e)||e.parentElement?.closest(commentSelector))continue;const c=read(e);c.replies=Array.from(e.querySelectorAll(commentSelector)).map(read);c.hasMoreReplies=Array.from(e.querySelectorAll('button,[role="button"]')).some(b=>/展开.*回复|查看.*回复|更多回复/.test(text(b)));comments.push(c);}
  const more=Array.from(area.querySelectorAll('button,[role="button"]')).filter(e=>owned(e)&&visible(e)).some(e=>/更多评论|加载更多/.test(text(e))&&!e.closest('.NestComment'));
  const end=/暂无评论|还没有评论|没有更多评论|全部评论已加载/.test(text(area));
  return {initial,title:text(document.querySelector(isAnswer?'.QuestionHeader-title':'.Post-Title,h1')),text:text(body),author:text(card?.querySelector('.AuthorInfo-name,.UserLink-link')||null),likes:text(card?.querySelector('.VoteButton--up')||null),time,comments,commentHasMore:end?false:more?true:undefined,preview:!!card?.querySelector('.RichContent-unfoldButton,.PaidContent,.PurchaseButton')};
 },{nid:note.id,kind:note.kind});
 let structured:NoteDetail|undefined;
 try{const initial=JSON.parse(raw.initial||'{}'),entities=initial.initialState?.entities||initial.entities;const o=entities?.[note.kind==='answer'?'answers':'articles']?.[note.id];if(o)structured=parseZhihuDetail(o,note);}catch{/* Incomplete initial state: use rendered content only. */}
 if(!raw.text&&!structured?.text)return;
 const norm=(c:any,depth=0):Comment=>({id:cleanText(c.id,100)||`dom-${hash(`${c.author}:${c.text}`)}`,author:cleanText(c.author,200)||'匿名',text:cleanText(c.text,20000),likes:cleanText(c.likes,30),time:cleanText(c.time,100)||undefined,replies:depth<3?(c.replies||[]).slice(0,500).map((r:any)=>norm(r,depth+1)):[],hasMoreReplies:c.hasMoreReplies===true});
 const comments=(raw.comments||[]).slice(0,500).map(c=>norm(c));
 const created=raw.time?.match(/发布于\s*(.*)/)?.[1],updated=raw.time?.match(/编辑于\s*(.*)/)?.[1];
 return {...note,...structured,title:cleanText(raw.title)||structured?.title||note.title,text:cleanText(raw.text)||structured!.text,author:cleanText(raw.author,200)||structured?.author||note.author,likes:cleanText(raw.likes,30).replace(/^赞同\s*/,'')||structured?.likes||note.likes,time:structured?.time||cleanText(created,100)||undefined,updatedTime:structured?.updatedTime||cleanText(updated,100)||undefined,accessNotice:raw.preview?'当前展示官网可访问的内容；可能为摘要或需要付费的内容。':structured?.accessNotice,comments,commentHasMore:raw.commentHasMore??structured?.commentHasMore,commentStatus:raw.commentHasMore===false?'一级评论已全部加载':comments.length?'可继续加载一级评论':'评论尚未加载'};
}
function hash(s:string):string{let h=0;for(const c of s)h=((h<<5)-h+c.charCodeAt(0))|0;return (h>>>0).toString(16);}
export async function findZhihuReplyButton(page:Page,comment:Comment):Promise<string|undefined> {
 return page.evaluate(target=>{
  const selector='.CommentItemV2,.CommentItemV3,.CommentItem',text=(e:Element|null)=>e instanceof HTMLElement?e.innerText.trim():e?.textContent?.trim()||'';
  const all=Array.from(document.querySelectorAll(selector));
  let root=all.find(e=>[e.getAttribute('data-id'),e.getAttribute('data-comment-id'),e.id.replace(/^comment[-_]/,'')].includes(target.id));
  if(!root){const matches=all.filter(e=>text(e.querySelector('.CommentItemV2-content,.CommentItemV3-content,.CommentItem-content'))===target.text&&text(e.querySelector('.UserLink-link'))===target.author);if(matches.length===1)root=matches[0];}
  if(!root)return;
  const area=root.closest('.NestComment')||root;
  const button=Array.from(area.querySelectorAll('button,[role="button"]')).find(e=>/展开.*回复|查看.*回复|更多回复/.test(text(e))&&(e.closest(selector)===root||!e.closest(selector)));
  if(!button)return;
  const parts:string[]=[];let e:Element|null=button;
  while(e&&e!==document.documentElement){const parent:Element|null=e.parentElement;if(!parent)return;parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${Array.from(parent.children).indexOf(e)+1})`);e=parent;}
  return 'html>'+parts.join('>');
 },comment);
}
export async function findZhihuCommentControl(page:Page,note:NoteSummary,kind:'more'|'initial'|'scroll'):Promise<string|undefined> {
 return page.evaluate(({nid,type,action})=>{
  const cards=Array.from(document.querySelectorAll(type==='answer'?'.AnswerItem':'.Post-Main,article'));
  const card=type==='answer'?cards.find(e=>e.getAttribute('data-aid')===nid||e.getAttribute('data-answer-id')===nid||e.querySelector(`meta[itemprop="url"][content$="/answer/${nid}"]`))||(cards.length===1&&!cards[0].hasAttribute('data-aid')&&!cards[0].hasAttribute('data-answer-id')&&!cards[0].querySelector('meta[itemprop="url"]')?cards[0]:undefined):cards[0];
  const owned=(e:Element)=>{if(action==='initial')return !!card?.contains(e);const owner=e.closest('.AnswerItem,.Post-Main,article');return owner?owner===card||!!card?.contains(e):cards.length<=1;};
  const selectors=action==='scroll'?'.Comments-container,.CommentsV2,.CommentsV3':'button,[role="button"]';
  const matches=Array.from(document.querySelectorAll(selectors)).filter(e=>e.getClientRects().length>0&&owned(e));
  const button=matches.find(e=>{const t=(e instanceof HTMLElement?e.innerText:e.textContent||'').replace(/[\u200b-\u200d\u2060\ufeff]/g,'').replace(/\s+/g,' ').trim();return action==='scroll'||(action==='more'?/^(加载更多评论|更多评论|查看更多评论)$/.test(t)&&!e.closest('.NestComment'): /^(\d+\s*条评论|添加评论|查看评论|评论\s*\d*)$/.test(t));});
  if(!button)return;
  const parts:string[]=[];let e:Element|null=button;
  while(e&&e!==document.documentElement){const parent:Element|null=e.parentElement;if(!parent)return;parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${Array.from(parent.children).indexOf(e)+1})`);e=parent;}
  return 'html>'+parts.join('>');
 },{nid:note.id,type:note.kind,action:kind});
}
