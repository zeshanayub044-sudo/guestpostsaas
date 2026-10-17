import {db,rpc,articleData,canonicalURL,text,integer,uuid} from '../_shared/core.ts';
import {WordPress} from '../_shared/wordpress.ts';
import {RemoteError,request} from '../_shared/network.ts';

const allowedOrigins=new Set(['https://zeshanayub044-sudo.github.io','http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:4173',...(Deno.env.get('ALLOWED_ORIGINS')??'').split(',').filter(Boolean)]);
async function execute(req:Request){
  const authorization=req.headers.get('Authorization')??'';
  const service=db();
  const {data:{user},error:authError}=await service.auth.getUser(authorization.replace(/^Bearer /i,''));
  if(authError||!user) return {status:401,body:{error:'Please sign in again.'}};
  const {data:actor}=await service.from('profiles').select('*').eq('id',user.id).eq('active',true).single();
  if(!actor)return {status:403,body:{error:'Your workspace access is disabled.'}};
  const raw=await req.text();if(raw.length>700000)throw new Error('Request exceeds the size limit.');
  const {action,data:b={}}=JSON.parse(raw);
  const admin=actor.role==='super_admin'||actor.role==='admin';
  const publisher=admin||actor.can_publish;
  const requireAdmin=()=>{if(!admin)throw new Error('Administrator permission required.');};
  const requirePublisher=()=>{if(!publisher)throw new Error('Publishing permission required.');};
  const own=async(table:string,id:unknown)=>{const{data,error}=await service.from(table).select('*').eq('id',uuid(id)).eq('tenant_id',actor.tenant_id).single();if(error||!data)throw new Error('Record not found in your workspace.');return data;};
  const audit=async(event:string,message:string)=>{const {error}=await service.from('publishing_logs').insert({tenant_id:actor.tenant_id,event_type:event,message});if(error)throw new Error('Audit log could not be saved.');};
  let output:any={ok:true};
  switch(action){
    case 'system.health':{
      requireAdmin();const response=await request('https://public-api.wordpress.com/rest/v1.1/sites/en.blog.wordpress.com');
      output={database:'connected',wordpress_https_transport:response.status===200?'reachable':'unexpected response'};break;
    }
    case 'website.save':{
      requireAdmin();
      const siteURL=canonicalURL(b.website_url);siteURL.search='';siteURL.pathname=siteURL.pathname.replace(/\/$/,'');
      const endpoint=canonicalURL(b.api_endpoint||siteURL.href.replace(/\/$/,'')+'/wp-json/wp/v2');
      if(endpoint.origin!==siteURL.origin||endpoint.search)throw new Error('API endpoint must use the website’s HTTPS origin without query parameters.');
      const payload={website_name:text(b.website_name,200,true),website_url:siteURL.href.replace(/\/$/,''),api_endpoint:endpoint.href.replace(/\/$/,''),cms_type:'wordpress',category:text(b.category,100),language:text(b.language||'en',20),status:b.status==='disabled'?'disabled':'active',min_interval_seconds:integer(b.min_interval_seconds??90,30,86400),updated_at:new Date().toISOString()};
      let id=b.id?uuid(b.id):crypto.randomUUID();
      if(b.id){
        const old=await own('websites',id);
        if(old.api_endpoint!==payload.api_endpoint){
          if(!b.username||!b.password)throw new Error('Supply fresh credentials when changing the API endpoint.');
          await rpc('revoke_credentials',{p_website:id});
        }
        const {error}=await service.from('websites').update(payload).eq('id',id).eq('tenant_id',actor.tenant_id);if(error)throw new Error(error.message);
      }else{
        if(!b.authorized)throw new Error('Confirm that you are authorized to publish to this website.');
        const {error}=await service.from('websites').insert({...payload,id,owner_id:actor.id,tenant_id:actor.tenant_id});if(error)throw new Error(error.message);
      }
      if(b.password){await rpc('store_credentials',{p_website:id,p_credentials:{username:text(b.username,200,true),password:text(b.password,500,true),api_endpoint:payload.api_endpoint}});}
      await audit('website_saved',payload.website_name+' saved.');output={id};break;
    }
    case 'website.test':{
      requireAdmin();const site=await own('websites',b.id);const creds=await rpc('read_credentials',{p_website:site.id});
      if(!creds||creds.api_endpoint!==site.api_endpoint)throw new Error('Save fresh application credentials for this API endpoint first.');
      let msg;try{
        const account=await new WordPress(site.api_endpoint,creds).test();msg='Authorized as '+account.account;
        const {error}=await service.from('websites').update({connection_status:'connected',connection_message:msg,tested_at:new Date().toISOString()}).eq('id',site.id);if(error)throw new Error('Could not save connection result.');
      }catch(e){
        msg=e instanceof RemoteError?e.message:'Could not validate the website connection.';
        await service.from('websites').update({connection_status:'error',connection_message:msg,tested_at:new Date().toISOString()}).eq('id',site.id);throw new Error(msg);
      }
      await audit('website_tested',site.website_name+': '+msg);output={message:msg};break;
    }
    case 'website.revoke':{
      requireAdmin();const site=await own('websites',b.id);await rpc('revoke_credentials',{p_website:site.id});await audit('credentials_revoked',site.website_name+': locally stored credentials revoked.');break;
    }
    case 'website.toggle':{
      requireAdmin();const site=await own('websites',b.id);const{error}=await service.from('websites').update({status:site.status==='active'?'disabled':'active'}).eq('id',site.id);if(error)throw error;await audit('website_status',site.website_name+': status updated.');break;
    }
    case 'website.delete':{
      requireAdmin();const site=await own('websites',b.id);
      const {count}=await service.from('publishing_jobs').select('id',{head:true,count:'exact'}).eq('website_id',site.id);
      if(count)throw new Error('This website has publishing history. Disable it to preserve the audit trail.');
      await rpc('revoke_credentials',{p_website:site.id});const{error}=await service.from('websites').delete().eq('id',site.id);if(error)throw error;await audit('website_deleted',site.website_name+' deleted.');break;
    }
    case 'article.save':{
      const payload=articleData(b);let id=b.id?uuid(b.id):crypto.randomUUID();
      if(b.id){await own('articles',id);const{error}=await service.from('articles').update({...payload,approved_by:null,approved_at:null,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw error;}
      else{const{error}=await service.from('articles').insert({...payload,id,owner_id:actor.id,tenant_id:actor.tenant_id});if(error)throw error;}
      await audit('article_saved',payload.title+' saved as '+payload.status+'.');output={id};break;
    }
    case 'article.approve':{
      requirePublisher();const article=await own('articles',b.id);
      if(!article.content.trim())throw new Error('Article content is empty.');
      const{error}=await service.from('articles').update({status:'approved',approved_by:actor.id,approved_at:new Date().toISOString()}).eq('id',article.id);if(error)throw error;await audit('article_approved',article.title+' approved for publication.');break;
    }
    case 'article.delete':{
      const article=await own('articles',b.id);if(!admin&&article.owner_id!==actor.id)throw new Error('Only the article author or an admin can delete it.');
      const{error}=await service.from('articles').delete().eq('id',article.id);if(error)throw new Error('This article is used by a campaign. Its history must be preserved.');await audit('article_deleted',article.title+' deleted.');break;
    }
    case 'campaign.create':{
      requirePublisher();const sites=(b.website_ids??[]).map(uuid);const overrides:Record<string,unknown>={};
      if(b.overrides&&typeof b.overrides==='object')for(const[id,version]of Object.entries(b.overrides)){
        uuid(id);const v=version as Record<string,unknown>;const cleaned:Record<string,unknown>={};
        for(const key of ['title','meta_title','meta_description','category'])if(v[key])cleaned[key]=text(v[key],key==='title'?300:500);
        if(v.content)cleaned.content=articleData({title:'variant',content:v.content}).content;
        if(v.tags)cleaned.tags=articleData({title:'variant',content:'variant',tags:v.tags}).tags;
        overrides[id]=cleaned;
      }
      if(!b.editorial_approved||!b.authorized)throw new Error('Editorial and website authorization confirmations are required.');
      const start=new Date(b.start_time||Date.now());if(!Number.isFinite(start.getTime()))throw new Error('Invalid start time.');
      output={id:await rpc('create_campaign',{p_actor:actor.id,p_article:uuid(b.article_id),p_name:text(b.campaign_name,200,true),p_sites:sites,p_interval:integer(b.interval,30,86400),p_start:start.toISOString(),p_overrides:overrides})};break;
    }
    case 'campaign.control':{
      requirePublisher();await rpc('control_campaign',{p_actor:actor.id,p_campaign:uuid(b.id),p_action:text(b.control,20,true)});break;
    }
    case 'job.retry':{
      requirePublisher();await rpc('retry_job',{p_actor:actor.id,p_job:uuid(b.id)});break;
    }
    case 'settings.save':{
      requireAdmin();const payload={workspace_name:text(b.workspace_name,100,true),default_interval:integer(b.default_interval,30,86400),max_attempts:integer(b.max_attempts,1,10)};
      const{error}=await service.from('settings').update(payload).eq('tenant_id',actor.tenant_id);if(error)throw error;await audit('settings_updated','Workspace publishing settings updated.');break;
    }
    case 'user.invite':{
      requireAdmin();const email=text(b.email,254,true).toLowerCase();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw new Error('Enter a valid email.');
      const role=b.role==='admin'?'admin':'editor';
      const{data:existing}=await service.from('profiles').select('id').eq('email',email).maybeSingle();if(existing)throw new Error('This email already belongs to an account. Use a different email.');
      const{error}=await service.from('tenant_invites').insert({tenant_id:actor.tenant_id,email,role,can_publish:!!b.can_publish});if(error)throw new Error('An invitation already exists for this email.');
      const invited=await service.auth.admin.inviteUserByEmail(email,{redirectTo:'https://zeshanayub044-sudo.github.io/guestpostsaas/'});
      if(invited.error){await service.from('tenant_invites').delete().eq('email',email).eq('tenant_id',actor.tenant_id);throw new Error('Invitation could not be sent. Check Auth email configuration.');}
      await audit('user_invited',email+' invited as '+role+'.');break;
    }
    case 'user.update':{
      requireAdmin();const target=await own('profiles',b.id);
      if(target.id===actor.id||target.role==='super_admin')throw new Error('Workspace owners and your own access cannot be changed here.');
      if(actor.role!=='super_admin'&&target.role==='admin')throw new Error('Only the workspace owner may manage administrators.');
      const{error}=await service.from('profiles').update({role:b.role==='admin'?'admin':'editor',active:b.active!==false,can_publish:!!b.can_publish}).eq('id',target.id);if(error)throw error;
      await audit('user_access_updated',target.email+': access updated.');break;
    }
    default:throw new Error('Unknown action.');
  }
  return {status:200,body:output};
}
Deno.serve(async req=>{
  const origin=req.headers.get('origin')??'';
  const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':allowedOrigins.has(origin)?origin:'https://zeshanayub044-sudo.github.io','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(origin&&!allowedOrigins.has(origin))return Response.json({error:'Origin is not allowed.'},{status:403,headers});
  if(req.method!=='POST')return Response.json({error:'Use POST.'},{status:405,headers});
  try{const{status,body}=await execute(req);return Response.json(body,{status,headers});}
  catch(error){const message=error instanceof Error?error.message:'Request failed.';return Response.json({error:message.includes('password')||message.includes('secret')?'The secure operation failed. Check the connection configuration.':message},{status:400,headers});}
});
