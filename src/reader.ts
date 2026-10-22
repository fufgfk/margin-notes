import {Channel,NoteSummary,NoteDetail} from './model';
export interface SearchResult {notes:NoteSummary[];hasMore:boolean;status:string}
export interface DiscoverResult extends SearchResult {channels:Channel[];channel:Channel}
export interface Reader {
  login():Promise<void>;close():Promise<void>;clear():Promise<void>;
  search(query:string,refresh?:boolean,rehydrate?:boolean):Promise<SearchResult>;
  moreSearch():Promise<SearchResult>;
  discover(channelId?:string,refresh?:boolean):Promise<DiscoverResult>;
  moreDiscover():Promise<DiscoverResult>;
  detail(note:NoteSummary,refresh?:boolean):Promise<NoteDetail>;
  moreComments(note?:NoteSummary):Promise<NoteDetail>;
  moreReplies(note:NoteDetail,commentId:string):Promise<NoteDetail>;
  answers?(question:NoteSummary,refresh?:boolean):Promise<SearchResult>;
  moreAnswers?():Promise<SearchResult>;
}
