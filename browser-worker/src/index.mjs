import {chromium} from 'playwright';
import {mkdir,writeFile,chmod} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {approvedOrigin,pinnedProxy} from './network.mjs';
import {runEditor,WorkflowError} from './editor.mjs';

const token=process.env.BROWSER_WORKER_TOKEN,gateway=process.env.BROWSER_GATEWAY_URL;
if(!token||!gateway||!/^https:\/\/[a-z]+\.supabase\.co\/functions\/v1\/browser-bridge$/.test(gateway)||!/^[a-f0-9]{96}$/.test(token))throw new Error('Configure BROWSER_GATEWAY_URL and BROWSER_WORKER_TOKEN in the server secret store.');
let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
async function call(body){const response=await fetch(gateway,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});if(!response.ok)throw new WorkflowError('lease_expired');return response.json();}
while(!stopping){
  let task,kind,context,browser,proxy,timer;
  try{
    const claim=await call({action:'poll'});if(claim.kind==='idle'){await delay(10000);continue;}
    ({task,kind}=claim);const deadline=Math.min(Date.parse(task.lease_until),Date.now()+120000);const abort=new AbortController();timer=setTimeout(()=>{abort.abort();context?.close().catch(()=>{});browser?.close().catch(()=>{});},Math.max(1,deadline-Date.now()));
    const origin=approvedOrigin(claim.site.website_url);proxy=await pinnedProxy(origin);
    browser=await chromium.launch({headless:true,chromiumSandbox:true,proxy:{server:proxy.url},args:['--proxy-bypass-list=<-loopback>','--disable-quic']});
    context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});
    await context.route('**/*',route=>{let allowed=false;try{allowed=new URL(route.request().url()).origin===origin;}catch{}return allowed?route.continue():route.abort();});
    const envelope={kind,id:task.id,lease_token:task.lease_token};
    const checkpoint=async(phase,remote_id)=>{if(abort.signal.aborted)throw new WorkflowError('lease_expired');await call({...envelope,action:'checkpoint',phase,remote_id});if(phase==='before_remote')task.remote_attempt_started=true;if(remote_id)task.remote_post_id=remote_id;};
    const result=await runEditor({...claim,context,checkpoint,signal:abort.signal});
    // Destroy authenticated browser state before acknowledging completion.
    await context.close();context=null;await browser.close();browser=null;
    for(let attempt=0;attempt<3;attempt++){try{await call({...envelope,action:'complete',...result});break;}catch(e){if(attempt===2)throw e;await delay(1000);}}
    console.log(JSON.stringify({event:'task_completed',kind,id:task.id}));
  }catch(error){
    const code=error instanceof WorkflowError?error.code:'network_error';
    // Debug screenshots fully mask page content. No cookies, traces, DOM dumps,
    // passwords or article text are retained. The phase/error code is the diagnostic.
    if(context&&process.env.DIAGNOSTICS_DIR){try{const page=context.pages()[0];const dir=process.env.DIAGNOSTICS_DIR;await mkdir(dir,{recursive:true,mode:0o700});const file=dir+'/'+task.id+'.png';await writeFile(file,await page.screenshot({mask:[page.locator('body')],maskColor:'#edf0f5'}),{mode:0o600});await chmod(file,0o600);}catch{}}
    await context?.close().catch(()=>{});context=null;await browser?.close().catch(()=>{});browser=null;
    if(task)await call({action:'complete',kind,id:task.id,lease_token:task.lease_token,success:false,code}).catch(()=>{});
    console.error(JSON.stringify({event:'task_stopped',kind,id:task?.id,code}));await delay(10000);
  }finally{clearTimeout(timer);await context?.close().catch(()=>{});await browser?.close().catch(()=>{});await proxy?.close().catch(()=>{});}
}
