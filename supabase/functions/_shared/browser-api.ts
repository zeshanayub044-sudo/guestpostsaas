import {db,rpc,text,uuid,canonicalURL} from './core.ts';
import {binding} from './connectors.ts';
import {failure,browserAdapters} from './browser-contract.mjs';

export async function sha256(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export const browserActions=new Set(['worker.register','worker.status','worker.revoke']);
export async function browserAction(actor:any,action:string,b:any){
  if(!['admin','super_admin'].includes(actor.role))throw new Error('Administrator permission required.');
  if(action==='worker.status'){const {data,error}=await db().from('browser_workers').select('id,name,active,last_seen_at,version').eq('tenant_id',actor.tenant_id);if(error)throw new Error('Worker status unavailable.');return {workers:data};}
  if(action==='worker.register'){
    const token=[...crypto.getRandomValues(new Uint8Array(48))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const id=await rpc('register_browser_worker',{p_actor:actor.id,p_name:text(b.name||'Publishing worker',100,true),p_hash:await sha256(token)});
    return {id,token,gateway:Deno.env.get('SUPABASE_URL')+'/functions/v1/browser-bridge'};
  }
  const {error}=await db().from('browser_workers').update({active:false}).eq('id',uuid(b.id)).eq('tenant_id',actor.tenant_id);if(error)throw new Error('Worker could not be revoked.');return {ok:true};
}
async function payload(worker:any,task:any,kind:string){
  const {data:site}=await db().from('websites').select('*').eq('id',task.website_id).eq('tenant_id',worker.tenant_id).single();
  if(!site||site.connection_method!=='browser'||!browserAdapters.includes(site.connector_config?.browser_workflow?.id))throw new Error('Browser connector is unavailable.');
  if(kind==='check'&&site.connection_version!==task.connection_version)throw new Error('Connection changed.');
  const credentials=await rpc('read_credentials',{p_website:site.id});
  if(!credentials||credentials.connection_key!==binding(site))throw new Error('Publishing credentials changed.');
  return {site,credentials};
}
export async function browserGateway(req:Request){
  if(req.method!=='POST')return new Response('Method not allowed',{status:405});
  try{
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer /i,'');if(!/^[a-f0-9]{96}$/.test(token))return new Response('Unauthorized',{status:401});
    const worker=await rpc('authenticate_browser_worker',{p_hash:await sha256(token),p_version:'3.0.0'});if(!worker)return new Response('Unauthorized',{status:401});
    const raw=await req.text();if(raw.length>12000)throw new Error('Task response exceeds size limit.');const b=JSON.parse(raw),action=b.action;
    if(action==='poll'){
      const check=await rpc('claim_browser_check',{p_worker:worker.id});
      if(check){try{return Response.json({kind:'check',task:check,...await payload(worker,check,'check')});}catch{await rpc('finish_browser_check',{p_worker:worker.id,p_check:check.id,p_token:check.lease_token,p_success:false,p_code:'session_expired',p_message:failure('session_expired')});return Response.json({kind:'idle'});}}
      const claimed=await rpc('claim_next_job',{p_method:'browser',p_worker:worker.id});
      if(!claimed)return Response.json({kind:'idle'});
      const {job,campaign,website}=claimed;
      try{
        const data=await payload(worker,job,'job');
        if(binding({...website,...job.target_snapshot})!==binding(data.site))throw new Error('Connection changed.');
        return Response.json({kind:'job',task:job,article:{...campaign.article_snapshot,...job.overrides},...data});
      }catch{await rpc('finish_job',{p_job:job.id,p_token:job.lease_token,p_result:{success:false,auth_invalid:true,error:failure('session_expired')}});return Response.json({kind:'idle'});}
    }
    const kind=b.kind==='check'?'check':'job';
    const table=kind==='check'?'connection_checks':'publishing_jobs';
    const {data:task}=await db().from(table).select('*').eq('id',uuid(b.id)).eq(kind==='check'?'worker_id':'browser_worker_id',worker.id).eq('tenant_id',worker.tenant_id).single();
    if(!task||task.lease_token!==b.lease_token)throw new Error('Task authorization denied.');
    // Idempotent acknowledgement of a lost completion response, never another remote operation.
    if(action==='complete'&&['published','verified','failed'].includes(task.status))return Response.json({ok:true,already_completed:true});
    if(task.status!=='processing'||Date.parse(task.lease_until)<=Date.now())throw new Error('Task lease expired.');
    const {site}=await payload(worker,task,kind);
    if(kind==='job'&&(binding({...site,...task.target_snapshot})!==binding(site)||Date.parse(task.started_at)+180000<=Date.now()))throw new Error('Task connection or deadline changed.');
    if(action==='checkpoint'&&kind==='job'){
      const name=b.phase==='remote_id'?'save_remote_id':b.phase==='before_remote'?'mark_remote_attempt':null;
      if(!name)throw new Error('Invalid checkpoint.');
      const args:any={p_job:task.id,p_token:task.lease_token};if(name==='save_remote_id')args.p_remote_id=text(b.remote_id,300,true);
      if(!await rpc(name,args))throw new Error('Task lease expired.');return Response.json({ok:true});
    }
    if(action==='heartbeat')return Response.json({ok:true,deadline:task.lease_until});
    if(action!=='complete')throw new Error('Unknown worker operation.');
    const success=b.success===true,code=text(b.code||'internal_error',80),message=failure(code);
    if(kind==='check'){
      const ok=await rpc('finish_browser_check',{p_worker:worker.id,p_check:task.id,p_token:task.lease_token,p_success:success,p_code:success?'':code,p_message:success?'Browser editorial fields and publishing permission verified.':message});if(!ok)throw new Error('Connection verification expired.');
    }else{
      let url:string|undefined;
      if(success){const u=canonicalURL(b.url);if(u.origin!==new URL(site.website_url).origin||u.searchParams.has('preview')||!task.remote_post_id)throw new Error('A verified public post and durable remote identifier are required.');url=u.href;}
      const uncertain=!success&&(task.remote_attempt_started||!!task.remote_post_id);
      await rpc('finish_job',{p_job:task.id,p_token:task.lease_token,p_result:{success,url,error:success?null:message,uncertain,auth_invalid:['invalid_credentials','session_expired','challenge_required','permission_denied'].includes(code),retryable:!uncertain&&code==='network_error',info:{connector_type:'browser',adapter:site.connector_config.browser_workflow.id,verification:success?'public_page_verified':'failed',remote_id:task.remote_post_id,error_code:success?null:code}}});
    }
    return Response.json({ok:true});
  }catch{return Response.json({error:'Worker task was rejected or its authorization expired.'},{status:409});}
}
