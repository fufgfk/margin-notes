const {ReaderBrowser}=require('../out/src/browser');
if(!process.env.MARGIN_PROFILE)throw new Error('Set a dedicated MARGIN_PROFILE outside the repository.');
const reader=new ReaderBrowser(process.env.MARGIN_PROFILE,()=>({headless:process.env.MARGIN_HEADED!=='1'}));
const total=comments=>comments.reduce((n,c)=>n+1+total(c.replies),0);
(async()=>{
 const results=await reader.search('咖啡');console.log('Search:',results.notes.length);
 const more=await reader.moreSearch();console.log('More search:',more.notes.length,'hasMore:',more.hasMore);
 const note=await reader.detail(results.notes[0]);console.log('Detail chars:',note.text.length,'comments:',note.comments.length,'including replies:',total(note.comments));
 for(let i=0;i<2;i++){const next=await reader.moreComments(note);console.log('More comments:',next.comments.length,'including replies:',total(next.comments),'status:',next.commentStatus);}
})().catch(e=>{console.log('Read failed:',e.message);process.exitCode=1;}).finally(()=>reader.close());
