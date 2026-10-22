import type { Channel, Comment, NoteSummary } from './model';
// Each function is self-contained because Playwright serializes it into the webpage.
export function readSearchDom():NoteSummary[] {
  const read=(root:Element,s:string)=>(root.querySelector(s) as HTMLElement|null)?.innerText?.trim()||'';
  return [...document.querySelectorAll('section.note-item, .feeds-container .note-item')].slice(0,300).flatMap(card=>{
    const links=[...card.querySelectorAll<HTMLAnchorElement>('a[href]')];
    const candidates=links.filter(a=>a.hostname==='www.xiaohongshu.com' && /\/(explore|search_result)\/[A-Za-z0-9_-]+/.test(a.pathname));
    const link=candidates.find(a=>new URL(a.href).searchParams.has('xsec_token'))||candidates[0];
    if(!link) return [];
    const id=link.pathname.split('/').filter(Boolean).pop()||'';
    return [{id,title:read(card,'.title')||read(card,'.footer .name')||'无标题笔记',author:read(card,'.author .name, .author-wrapper .name, .name'),likes:read(card,'.like-wrapper .count, .count'),url:link.href}];
  });
}
export function readDetailDom():{title:string;text:string;author:string;time?:string;comments:Comment[]} {
  const read=(root:Element|Document,s:string)=>(root.querySelector(s) as HTMLElement|null)?.innerText?.trim()||'';
  const root=document.querySelector('.note-detail-mask, #noteContainer, .note-container')||document;
  const list=root.querySelector('.comments-container, .comments-el, .comment-list');
  const hash=(s:string)=>{let h=0;for(let i=0;i<s.length;i++)h=(Math.imul(31,h)+s.charCodeAt(i))|0;return String(h>>>0);};
  const convert=(el:Element,depth:number):Comment=>{
    const text=read(el,'.content .note-text, .content, .comment-content');
    const author=read(el,'.author .name, .user-name, .name');
    const group=el.parentElement?.classList.contains('parent-comment')?el.parentElement:el;
    const children=depth<3?[...group.querySelectorAll('.comment-item')].filter(c=>c!==el && (group===el?c.parentElement?.closest('.comment-item')===el:c.closest('.parent-comment')===group&&!c.parentElement?.closest('.comment-item'))):[];
    const date=[...el.querySelectorAll<HTMLElement>('.date, time, .time')].find(e=>e.closest('.comment-item')===el);
    const time=date?.innerText?.trim()||date?.getAttribute('datetime')||undefined;
    const rawId=el.getAttribute('data-id')||el.id;
    return {time,id:rawId?rawId.replace(/^comment-/,''):'dom-'+hash(author+'|'+text),text,author:author||'匿名',likes:read(el,'.like .count, .like-wrapper .count'),replies:children.map(c=>convert(c,depth+1)),hasMoreReplies:[...group.querySelectorAll('.show-more, .show-more-replies')].some(x=>(group===el?x.closest('.comment-item')===el:x.closest('.parent-comment')===group&&!x.closest('.comment-item'))&&(x as HTMLElement).innerText.includes('展开'))};
  };
  const nodes=list?[...list.querySelectorAll('.comment-item')].filter(el=>!el.parentElement?.closest('.comment-item') && (!el.closest('.parent-comment')||el.closest('.parent-comment')?.querySelector('.comment-item')===el)):[];
  const date=[...root.querySelectorAll<HTMLElement>('.bottom-container .date, .note-content .date, .note-content time, .note-scroller .date')].find(e=>!e.closest('.comment-item, .comments-container, .comments-el, .comment-list'));
  return {time:date?.innerText?.trim()||date?.getAttribute('datetime')||undefined,title:read(root,'#detail-title, .note-content .title'),text:read(root,'#detail-desc, .note-content .desc'),author:read(root,'.author-container .username, .author-container .name, .author-wrapper .username'),comments:nodes.slice(0,500).map(el=>convert(el,0))};
}
export function scrollContent(toEnd=false):void {
  const candidates=[...document.querySelectorAll<HTMLElement>('.note-scroller, .comments-container, .note-container, .main-container, .feeds-container, .scroll-container')];
  const scrollers=candidates.filter(e=>e.scrollHeight>e.clientHeight+20 && /auto|scroll/.test(getComputedStyle(e).overflowY));
  for(const e of scrollers) e.scrollTop=toEnd?e.scrollHeight:e.scrollTop+Math.max(600,e.clientHeight*0.8);
  if(!scrollers.length) {if(toEnd)window.scrollTo(0,document.documentElement.scrollHeight);else window.scrollBy(0,Math.max(700,window.innerHeight*0.8));}
}
export function findCommentReplyButton(target:Pick<Comment,'id'|'text'|'author'>):string|null {
  const root=document.querySelector('.comments-container, .comments-el, .comment-list');
  if(!root)return null;
  const nodes=[...root.querySelectorAll<HTMLElement>('.comment-item')];
  const exact=nodes.filter(e=>e.getAttribute('data-id')===target.id||e.id===target.id||e.id==='comment-'+target.id);
  const read=(e:Element,s:string)=>(e.querySelector(s) as HTMLElement|null)?.innerText.trim()||'';
  const matches=exact.length?exact:nodes.filter(e=>read(e,'.content .note-text, .content, .comment-content')===target.text && read(e,'.author .name, .user-name, .name')===target.author);
  if(matches.length!==1)return null;
  const node=matches[0];
  const group=node.parentElement?.classList.contains('parent-comment')?node.parentElement:node;
  const button=[...group.querySelectorAll<HTMLElement>('.show-more, .show-more-replies, .expand, button')].find(e=>(group===node?e.closest('.comment-item')===node:e.closest('.parent-comment')===group&&!e.closest('.comment-item')) && /^(展开|查看|更多).*(回复|条)|^展开更多$/.test(e.innerText.trim()) && e.getClientRects().length>0);
  if(!button)return null;
  const path:string[]=[];
  let element:Element|null=button;
  while(element){
    const parent:Element|null=element.parentElement;
    path.unshift(element.localName+(parent?`:nth-child(${[...parent.children].indexOf(element)+1})`:''));
    element=parent;
  }
  return path.join(' > ');
}

export function readChannelsDom():Array<Channel&{active:boolean}> {
  const tabs=[...document.querySelectorAll<HTMLElement>('.channel-container .channel[id], #channel-container .channel[id]')];
  const channels=new Map<string,Channel&{active:boolean}>();
  for(const tab of tabs) {
    const name=tab.innerText.trim();
    if(!name || !/^[A-Za-z0-9_.-]{1,100}$/.test(tab.id) || !tab.getClientRects().length || getComputedStyle(tab).visibility==='hidden') continue;
    channels.set(tab.id,{id:tab.id,name:name.slice(0,50),active:tab.classList.contains('active')||!!tab.querySelector('.channel-content.active')||tab.getAttribute('aria-selected')==='true'});
  }
  return [...channels.values()].sort((a,b)=>Number(b.name==='推荐')-Number(a.name==='推荐'));
}
