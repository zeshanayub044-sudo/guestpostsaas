import {rpc} from '../_shared/core.ts';
import {connector} from '../_shared/registry.ts';
import {binding} from '../_shared/connectors.ts';
import {validateArticleForSite} from '../_shared/campaigns.ts';
import {RemoteError} from '../_shared/network.ts';
Deno.serve(async req=>{
  if(req.method!=='POST')return new Response('Method not allowed',{status:405});
  const token=req.headers.get('x-scheduler-token');
  if(!token||token.length<32||!await rpc('verify_worker_token',{p_token:token}))return new Response('Unauthorized',{status:401});
  const claimed=await rpc('claim_next_job');
  if(!claimed)return Response.json({processed:0});
  const {job,campaign,website}=claimed;
  let result;
  try{
    const creds=await rpc('read_credentials',{p_website:website.id});
    const target={...website,...job.target_snapshot};
    if(!creds||creds.connection_key!==binding(website)||binding(target)!==binding(website))throw new RemoteError('Credentials were revoked or the destination changed. Reconnect this website before retrying.',401);
    const publisher=connector(target,creds);
    const article={...campaign.article_snapshot,...job.overrides};
    validateArticleForSite(target,article);
    await publisher.test();
    result={success:true,...await publisher.publish(job,article)};
  }catch(error){
    const e=error instanceof RemoteError?error:new RemoteError('Internal worker error. Inspect the function diagnostics.');
    // Requests with unknown outcomes only reconcile on manual retry. Known 429/5xx responses can retry automatically.
    const uncertain=e.uncertain&&job.remote_attempt_started&&!job.remote_post_id;
    result={success:false,error:e.message,uncertain,auth_invalid:e.status===401||e.status===403,retryable:!uncertain&&(e.status===429||e.status>=500||e.status===0),retry_after:e.retryAfter};
  }
  try{await rpc('finish_job',{p_job:job.id,p_token:job.lease_token,p_result:result});}
  catch{ return Response.json({error:'Job completion could not be committed; lease recovery will require reconciliation.'},{status:500}); }
  return Response.json({processed:1,job_id:job.id,status:result.success?'published':'attempt_failed'});
});
