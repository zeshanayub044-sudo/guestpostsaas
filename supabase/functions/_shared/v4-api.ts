import {db,rpc,text,uuid,integer,canonicalURL} from './core.ts';
import {importInventory,retryDiscovery} from './inventory.ts';
import {request} from './network.ts';
import catalog from './catalog.json' with {type:'json'};
import {verifyWixPermissions} from './permission-checks.ts';

export const v4Actions=new Set(['website.import','website.options','website.verify_permissions','import.retry','connector.registry','integration.google.status','integration.google.begin','integration.google.revoke','integration.google.refresh','quality.save','metrics.record','website.discover.saved']);
export async function v4Action(actor:any,action:string,b:any){
  const service=db(),admin=['admin','super_admin'].includes(actor.role);
  if(!action.startsWith('integration.')&&action!=='connector.registry'&&!admin)throw new Error('Administrator permission required.');
  const ownSite=async()=>{const {data,error}=await service.from('websites').select('*').eq('id',uuid(b.id)).eq('tenant_id',actor.tenant_id).single();if(error||!data)throw new Error('Website not found in this workspace.');return data;};
  if(action==='website.import')return importInventory(actor,b);
  if(action==='website.verify_permissions')return verifyWixPermissions(actor,b);
  if(action==='website.options'){
    const url=canonicalURL(b.website_url),credential=text(b.password,4000,true),platform=text(b.cms_type,40),config=b.connector_config||{};
    if(platform==='webflow'){
      const headers={Authorization:'Bearer '+credential};const {data}=await request('https://api.webflow.com/v2/sites','GET',headers);
      const sites=(data.sites||[]).filter((s:any)=>(s.customDomains||[]).some((d:any)=>String(d.url||d.name).replace(/^https?:\/\//,'').replace(/\/$/,'')===url.hostname)||s.shortName+'.webflow.io'===url.hostname);
      if(sites.length!==1)throw new Error('The Webflow token did not identify exactly one matching public website. Check sites:read scope and its custom domain.');
      const {data:collections}=await request('https://api.webflow.com/v2/sites/'+encodeURIComponent(sites[0].id)+'/collections','GET',headers);
      return {platform,site_id:sites[0].id,options:(collections.collections||[]).map((c:any)=>({id:c.id,name:c.displayName||c.slug,config:{site_id:sites[0].id,collection_id:c.id}})),message:'Choose the article collection. Its public URL and content field must match your Webflow template.'};
    }
    if(platform==='shopify'){
      const domain=String(config.shop_domain||url.hostname).toLowerCase();if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain))throw new Error('Supply the store’s myshopify.com domain.');let token=credential;
      if(config.client_id){const {data}=await request('https://'+domain+'/admin/oauth/access_token','POST',{'Content-Type':'application/x-www-form-urlencoded'},new URLSearchParams({grant_type:'client_credentials',client_id:text(config.client_id,200,true),client_secret:credential}).toString());token=data.access_token;if(!token)throw new Error('The installed app could not authorize this Shopify store.');}
      const {data}=await request('https://'+domain+'/admin/api/2026-10/graphql.json','POST',{'X-Shopify-Access-Token':token,'Content-Type':'application/json'},JSON.stringify({query:'query{blogs(first:100){nodes{id title handle}} shop{primaryDomain{url}}}'}));
      if(data.errors||new URL(data.data?.shop?.primaryDomain?.url).hostname!==url.hostname)throw new Error('The Shopify store or app scopes do not match this public website.');
      return {platform,options:(data.data.blogs.nodes||[]).map((x:any)=>({id:x.id,name:x.title,config:{blog_id:x.id,blog_handle:x.handle}})),message:'Choose the blog this account may publish to.'};
    }
    if(platform==='joomla'){
      const {data}=await request(url.href.replace(/\/$/,'')+'/api/index.php/v1/content/categories?page[limit]=100','GET',{'X-Joomla-Token':credential,Accept:'application/vnd.api+json'});return {platform,options:(data.data||[]).map((c:any)=>({id:c.id,name:c.attributes?.title||String(c.id),config:{category_id:c.id}})),message:'Choose an existing article category. Publishing permissions must still be verified.'};
    }
    throw new Error('This platform does not expose a supported automatic configuration picker. Follow its connection instructions.');
  }
  if(action==='import.retry')return retryDiscovery(actor,b.id);
  if(action==='website.discover.saved'){
    const site=await ownSite();const {discover}=await import('./connections.ts');const result=await discover(site.website_url);
    const {error}=await service.from('websites').update({connection_report:result.report,...(site.connection_status!=='connected'?{cms_type:result.platform,connection_status:result.status,connection_message:result.guide}:{}),updated_at:new Date().toISOString()}).eq('id',site.id).eq('connection_version',site.connection_version);if(error)throw new Error('Connection report could not be saved. Refresh and retry.');return result;
  }
  if(action==='connector.registry'){
    const {data,error}=await service.from('platform_connectors').select('*').order('name');if(error)throw new Error('The connector registry could not be loaded.');
    return {connectors:data.map((p:any)=>({...p,implemented:catalog.some(c=>c.id===p.id&&c.automatic),backend:'deployed',live_verification:'requires authorized destination test'})),google_configured:!!Deno.env.get('GOOGLE_CLIENT_ID')&&!!Deno.env.get('GOOGLE_CLIENT_SECRET')};
  }
  if(action==='quality.save'){
    const filters={enabled:b.enabled===true,minimum_da:integer(b.minimum_da??30,0,100),maximum_spam:integer(b.maximum_spam??9,0,100),minimum_traffic:integer(b.minimum_traffic??1000,0,1000000000),category:text(b.category,100),country:text(b.country,100),language:text(b.language,20)};
    const {error}=await service.from('settings').update({quality_filters:filters}).eq('tenant_id',actor.tenant_id);if(error)throw new Error('Quality filters could not be saved.');return {filters};
  }
  if(action==='metrics.record'){
    const site=await ownSite(),metric=String(b.metric),provider=String(b.provider);if(!['domain_authority','spam_score','estimated_organic_traffic','domain_rating'].includes(metric)||!['moz','semrush','ahrefs','first_party'].includes(provider))throw new Error('Choose the metric and its licensed data provider.');
    if(metric==='domain_authority'&&provider!=='moz'||metric==='domain_rating'&&provider!=='ahrefs')throw new Error('Moz Domain Authority and Ahrefs Domain Rating must keep their own provider labels.');
    const value=Number(b.value);if(!Number.isFinite(value)||value<0||metric!=='estimated_organic_traffic'&&value>100)throw new Error('Metric value is outside its valid range.');
    const source=canonicalURL(b.source_url).href,observed=new Date(b.observed_at);if(!Number.isFinite(observed.getTime())||observed.getTime()>Date.now())throw new Error('Use the actual report date, no later than today.');
    const {error}=await service.from('website_metrics').upsert({tenant_id:actor.tenant_id,website_id:site.id,metric,provider,value,source_url:source,observed_at:observed.toISOString(),verification:'reported'},{onConflict:'website_id,metric'});if(error)throw new Error('Metric evidence could not be saved.');return {message:'Report value saved with its provider and date. It remains reported until verified through the provider.'};
  }
  if(action==='integration.google.status'){
    const {data,error}=await service.from('user_integrations').select('id,account_email,status,scopes,expires_at,updated_at').eq('owner_id',actor.id).maybeSingle();if(error)throw new Error('Google account status could not be loaded.');
    return {configured:!!Deno.env.get('GOOGLE_CLIENT_ID')&&!!Deno.env.get('GOOGLE_CLIENT_SECRET'),integration:data?{...data,status:data.status==='connected'&&Date.parse(data.expires_at)<Date.now()?'expired':data.status}:null,mailbox_access:false,website_permission:false,callback:Deno.env.get('SUPABASE_URL')+'/functions/v1/oauth-callback'};
  }
  if(action==='integration.google.begin'){
    const client=Deno.env.get('GOOGLE_CLIENT_ID');if(!client||!Deno.env.get('GOOGLE_CLIENT_SECRET'))throw new Error('Google OAuth application setup is missing. The workspace owner must configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and register the callback shown in Settings.');
    const encode=(a:Uint8Array)=>btoa(String.fromCharCode(...a)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
    const state=encode(crypto.getRandomValues(new Uint8Array(32))),verifier=encode(crypto.getRandomValues(new Uint8Array(48))),challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
    await rpc('begin_google_account',{p_actor:actor.id,p_state:state,p_verifier:verifier});
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:client,redirect_uri:Deno.env.get('SUPABASE_URL')+'/functions/v1/oauth-callback',response_type:'code',scope:'openid email profile',access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();return {url:url.href};
  }
  if(action==='integration.google.revoke'){
    const tokens=await rpc('read_google_account',{p_actor:actor.id});let providerRevoked=!tokens;
    if(tokens){try{await request('https://oauth2.googleapis.com/revoke','POST',{'Content-Type':'application/x-www-form-urlencoded'},new URLSearchParams({token:tokens.refresh_token||tokens.access_token}).toString());providerRevoked=true;}catch{/* Local erasure remains available during provider outages. */}}
    await rpc('revoke_google_account',{p_actor:actor.id});return {message:providerRevoked?'Google consent revoked and local tokens erased.':'Local tokens erased. Google could not confirm revocation; remove this app in your Google account permissions as well.',provider_revoked:providerRevoked};
  }
  if(action==='integration.google.refresh'){
    const tokens=await rpc('read_google_account',{p_actor:actor.id});if(!tokens?.refresh_token)throw new Error('Reconnect Google to renew consent.');
    const {data:refreshed}=await request('https://oauth2.googleapis.com/token','POST',{'Content-Type':'application/x-www-form-urlencoded'},new URLSearchParams({grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:Deno.env.get('GOOGLE_CLIENT_ID')||'',client_secret:Deno.env.get('GOOGLE_CLIENT_SECRET')||''}).toString());
    const {data:integration}=await service.from('user_integrations').select('*').eq('owner_id',actor.id).single();if(!refreshed.access_token||!integration)throw new Error('Google authorization could not be renewed. Reconnect Google.');
    await rpc('store_google_account',{p_actor:actor.id,p_email:integration.account_email,p_subject:integration.provider_subject,p_scopes:integration.scopes,p_expires:new Date(Date.now()+Number(refreshed.expires_in||3600)*1000).toISOString(),p_tokens:{...tokens,...refreshed}});return {message:'Google authorization renewed.'};
  }
  throw new Error('Unknown V4 operation.');
}
