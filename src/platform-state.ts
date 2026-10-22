import {NoteSummary,Platform} from './model';
import {ReadingState} from './state';
export function contentKey(note:Pick<NoteSummary,'id'|'kind'|'platform'>):string {
  return `${note.platform||'xiaohongshu'}:${note.kind||'note'}:${note.id}`;
}
export class PlatformState {
  private generation=0;
  private states:Record<Platform,ReadingState>={xiaohongshu:new ReadingState(),zhihu:new ReadingState()};
  constructor(public platform:Platform='xiaohongshu'){}
  state(platform=this.platform):ReadingState{return this.states[platform];}
  select(platform:Platform):void {this.states[this.platform].hide();this.generation++;this.platform=platform;}
  begin():number{return ++this.generation;}
  current(ticket:number,platform:Platform):boolean{return ticket===this.generation&&platform===this.platform;}
}
