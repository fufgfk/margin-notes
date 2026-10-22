import { Channel, NoteDetail, NoteSummary } from './model';
export class ReadingState {
  private generation=0;
  note?:NoteDetail;
  results:NoteSummary[]=[];
  query='';
  source:'search'|'discover'='discover';
  channel?:Channel;
  channels:Channel[]=[];
  listReady=false;
  hasMoreList=true;
  question?:NoteSummary;
  answerResults:NoteSummary[]=[];
  answerHasMore=true;
  listMode:'source'|'answers'='source';
  lastView:'list'|'note'='list';
  get resumeTarget():'discover'|'list'|'note' {
    return this.lastView==='note'&&this.note?'note':this.listReady?'list':'discover';
  }
  resetList(source:'search'|'discover',query=''):void {
    this.source=source;this.query=query;this.results=[];this.listReady=false;this.lastView='list';this.listMode='source';this.question=undefined;this.answerResults=[];
  }
  begin():number {return ++this.generation;}
  current(ticket:number):boolean {return this.generation===ticket;}
  hide():void {this.generation++;}
  clear():void {this.hide();this.note=undefined;this.resetList('discover');this.channel=undefined;this.channels=[];}
}
