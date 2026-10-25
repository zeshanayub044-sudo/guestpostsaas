import {db,rpc,uuid} from './core.ts';
import {binding} from './connectors.ts';
import {request,RemoteError} from './network.ts';
export async function verifyWixPermissions(actor:any,b:any){
  if(!['admin','super_admin'].includes(actor.role))throw new Error('Administrator permission required.');
  if(b.authorized_draft_check!==true)throw new Error('Approve creating and removing one unpublished Wix test draft. No public article will be published.');
  const service=db(),{data:site}=await service.from('websites').select('*').eq('id',uuid(b.id)).eq('tenant_id',actor.tenant_id).single();
  if(!site||site.cms_type!=='wix'||site.connection_method!=='api')throw new Error('Choose a Wix API connection.');
  const credentials=await rpc('read_credentials',{p_website:site.id});if(!credentials||credentials.connection_key!==binding(site))throw new Error('Reconnect the Wix account first.');
  const {data:old}=await service.from('connection_permission_checks').select('*').eq('website_id',site.id).eq('connection_version',site.connection_version).maybeSingle();
  if(old?.status==='verified'){
    if(Date.parse(old.completed_at)<Date.now()-86400000)throw new Error('The saved Wix permission proof expired. Reconnect with a fresh dedicated credential and verify its scope again.');
    const {Wix}=await import('./additional-connectors.ts');await new Wix(site,credentials).test();
    const {error}=await service.from('websites').update({permission_status:'verified',connection_status:'connected',connection_message:'Wix Manage Blog scope was verified by an unpublished draft check for this credential version.'}).eq('id',site.id).eq('connection_version',site.connection_version).select('id').single();if(error)throw new Error('The credential changed during the permission recheck.');
    return {message:'Wix account access rechecked; the recent Manage Blog proof matches this credential version.'};
  }
  let check=old;
  if(!check){const id=crypto.randomUUID(),result=await service.from('connection_permission_checks').insert({id,tenant_id:actor.tenant_id,website_id:site.id,connection_version:site.connection_version,status:'creating',marker:'gps-permission-'+id}).select('*').single();if(result.error)throw new Error('A permission check is already in progress. Refresh its diagnostics before retrying.');check=result.data;}
  const headers={Authorization:credentials.password,'wix-site-id':site.connector_config.site_id,'Content-Type':'application/json'};
  const call=(path:string,method='GET',body?:any)=>request('https://www.wixapis.com/blog/v3'+path,method,headers,body===undefined?undefined:JSON.stringify(body));
  let remote=check.remote_id;
  try{
    if(!remote&&old){
      const {data}=await call('/draft-posts/query','POST',{query:{filter:{title:{$eq:check.marker}},paging:{limit:100}}});const found=(data.draftPosts||[]).filter((p:any)=>p.title===check.marker&&p.seoSlug===check.marker);
      if(found.length!==1)throw new RemoteError('The previous draft check has an uncertain outcome. Inspect Wix drafts for '+check.marker+' before retrying.',0,0,true);remote=String(found[0].id);
    }
    if(!remote){
      const {data}=await call('/draft-posts','POST',{draftPost:{title:check.marker,seoSlug:check.marker,memberId:site.connector_config.member_id,richContent:{nodes:[],metadata:{version:1}}},publish:false});
      if(!data.draftPost?.id)throw new RemoteError('Wix did not return the unpublished verification draft ID.',0,0,true);remote=String(data.draftPost.id);
    }
    const {error:saved}=await service.from('connection_permission_checks').update({remote_id:remote,status:'cleanup_pending'}).eq('id',check.id);if(saved)throw new Error('The verification draft ID could not be saved. Reconcile the existing draft before retrying.');
    try{await call('/draft-posts/'+encodeURIComponent(remote)+'?permanent=true','DELETE');}catch(e){if(!(e instanceof RemoteError&&e.status===404))throw e;}
    const {error:updated}=await service.from('websites').update({permission_status:'verified',connection_status:'connected',connection_message:'Wix Manage Blog permission and author verified using an unpublished draft; the draft was removed.',tested_at:new Date().toISOString()}).eq('id',site.id).eq('connection_version',site.connection_version).select('id').single();if(updated)throw new Error('The credential changed during verification. Refresh the website connection.');
    await service.from('connection_permission_checks').update({status:'verified',completed_at:new Date().toISOString(),error_code:null}).eq('id',check.id);return {message:'Wix publishing scope verified. The unpublished test draft was removed.'};
  }catch(error){await service.from('connection_permission_checks').update({status:remote?'cleanup_pending':error instanceof RemoteError&&error.uncertain?'outcome_unknown':'failed',remote_id:remote||null,error_code:remote?'draft_cleanup_or_commit_pending':'permission_check_failed'}).eq('id',check.id);throw error;}
}
