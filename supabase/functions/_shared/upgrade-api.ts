import {db,rpc,text,uuid,integer,canonicalURL} from './core.ts';
import {discover,connectWebsite,testConnection} from './connections.ts';
import {binding} from './connectors.ts';
import {campaignPlan,startCampaign} from './campaigns.ts';
import {can} from './authorization.ts';

export const upgradeActions=new Set(['website.discover','website.connect','website.save','website.test','website.import','campaign.preview','campaign.start','campaign.create','oauth.google.begin']);
export async function upgradeAction(actor:any,action:string,b:any){
  const admin=can(actor,action==='website.save'?'websites.update':action==='website.import'?'websites.create':'websites.connect'),service=db();
  if(action.startsWith('website.')||action.startsWith('oauth.')){if(!admin)throw new Error('Administrator permission required.');}
  else if(!can(actor,action==='campaign.preview'?'campaigns.create':'campaigns.launch'))throw new Error('Publishing permission required.');
  const own=async(id:unknown)=>{const{data}=await service.from('websites').select('*').eq('id',uuid(id)).eq('tenant_id',actor.tenant_id).single();if(!data)throw new Error('Website not found in your workspace.');return data;};
  let result:any;
  if(action==='website.discover')return discover(b.website_url);
  if(action==='website.connect'||action==='website.save')result=await connectWebsite(actor,b);
  if(action==='website.test'){
    const site=await own(b.id),credentials=await rpc('read_credentials',{p_website:site.id});
    if(!credentials||credentials.connection_key!==binding(site))throw new Error('Reconnect this website using its supported authorization method.');
    if(site.connection_method==='browser'){await rpc('enqueue_browser_check',{p_actor:actor.id,p_website:site.id});return {status:'checking',message:'Browser workflow verification queued. The result appears in Websites.'};}
    try{const verified=await testConnection(site,credentials);const{error}=await service.from('websites').update({connection_status:'connected',permission_status:verified.permission_status,connection_message:verified.message,tested_at:new Date().toISOString()}).eq('id',site.id);if(error)throw new Error('Could not save the connection test.');result={...verified,status:'connected'};}
    catch(e){await service.from('websites').update({connection_status:'authorization_required',permission_status:'unverified',connection_message:'The connection needs attention. Reconnect the supported publishing account.'}).eq('id',site.id);throw new Error(e instanceof Error?e.message:'Connection test failed.');}
  }
  if(action==='website.import'){
    if(!b.authorized)throw new Error('Confirm that these websites are authorized.');
    if(!Array.isArray(b.rows)||b.rows.length<1||b.rows.length>500)throw new Error('Import 1–500 website rows.');
    const rows=b.rows.map((r:any)=>{if(Object.keys(r).some(k=>/password|secret|token|credential/i.test(k)))throw new Error('CSV import accepts website details only, without credentials.');const u=canonicalURL(r.website_url);u.search='';const website_url=u.href.replace(/\/$/,'');return {tenant_id:actor.tenant_id,owner_id:actor.id,website_name:text(r.website_name||u.hostname,200,true),website_url,api_endpoint:website_url,cms_type:'manual',connection_status:'untested',category:text(r.category,100),language:text(r.language||'en',20)};});
    if(new Set(rows.map((r:any)=>r.website_url)).size!==rows.length)throw new Error('The CSV contains duplicate website URLs.');
    const {data,error}=await service.from('websites').upsert(rows,{onConflict:'tenant_id,website_url',ignoreDuplicates:true}).select('id');if(error)throw new Error('The website import could not be saved.');result={imported:data.length,skipped:rows.length-data.length,message:`${data.length} websites imported. Connect their accounts before automatic publishing.`};
  }
  if(action==='campaign.preview')return campaignPlan(actor,b);
  if(action==='campaign.start'||action==='campaign.create')result=await startCampaign(actor,{...b,quantity:b.quantity??b.website_ids?.length,mode:b.mode||(b.website_ids?'manual':'auto')});
  if(action==='oauth.google.begin'){
    const site=await own(b.id);if(site.cms_type!=='blogger')throw new Error('Choose a Blogger website first.');
    const client=Deno.env.get('GOOGLE_CLIENT_ID');if(!client||!Deno.env.get('GOOGLE_CLIENT_SECRET'))throw new Error('Google authorization needs workspace setup. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in this project’s Edge Function secrets and register the oauth-callback URL in Google Cloud. Your Google password cannot be used as an API credential.');
    const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
    const state=encode(crypto.getRandomValues(new Uint8Array(32))),verifier=encode(crypto.getRandomValues(new Uint8Array(48))),challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
    await rpc('begin_google_connection',{p_actor:actor.id,p_website:site.id,p_state:state,p_verifier:verifier});
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:client,redirect_uri:Deno.env.get('SUPABASE_URL')+'/functions/v1/oauth-callback',response_type:'code',scope:'https://www.googleapis.com/auth/blogger',access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();return {url:url.href};
  }
  await service.from('publishing_logs').insert({tenant_id:actor.tenant_id,actor_id:actor.id,event_type:action.replaceAll('.','_'),message:action.startsWith('website.')?'Website connection details updated.':'Publishing campaign confirmed and scheduled.'});
  return result;
}
