const {ReaderBrowser}=require('../out/src/browser');
if(!process.env.MARGIN_PROFILE)throw new Error('Set a dedicated MARGIN_PROFILE outside the repository.');
const reader=new ReaderBrowser(process.env.MARGIN_PROFILE,()=>({headless:true}));
(async()=>{
 const recommended=await reader.discover();console.log('Default:',recommended.channel.name,'notes:',recommended.notes.length,'categories:',recommended.channels.map(c=>c.name).join(' / '));
 const more=await reader.moreDiscover();console.log('More recommendation:',more.notes.length);
 const target=recommended.channels.find(c=>c.name==='美食')||recommended.channels[1];
 if(target){const switched=await reader.discover(target.id);console.log('Switched:',switched.channel.name,'notes:',switched.notes.length);const extra=await reader.moreDiscover();console.log('More category:',extra.notes.length);if(switched.notes[0]){const detail=await reader.detail(switched.notes[0]);console.log('Detail chars:',detail.text.length,'root comments:',detail.comments.length);}}
})().catch(e=>{console.log('Discover check failed:',e.message);process.exitCode=1;}).finally(()=>reader.close());
