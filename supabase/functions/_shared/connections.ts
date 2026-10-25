import {db,rpc,canonicalURL,text,integer} from './core.ts';
import {request,RemoteError} from './network.ts';
import {connector} from './registry.ts';
import {binding,Website} from './connectors.ts';
import catalog from './catalog.json' with {type:'json'};
import {browserDiscovery} from './browser-contract.mjs';

const fail=(message:string)=>new RemoteError(message,400);
export async function discover(value:unknown){
  let u=canonicalURL(value);u.search='';u.hash='';let html='',headers:Record<string,string>={};let reachable=false;
  try{let result;for(let i=0;i<4;i++){try{result=await request(u.href,'GET',{},undefined,6000,'text');break;}catch(e){if(!(e instanceof RemoteError)||!e.location||i===3)throw e;const next=canonicalURL(new URL(e.location,u).href);if(next.hostname.replace(/^www\./,'')!==u.hostname.replace(/^www\./,''))throw e;u=next;}}if(!result)throw new Error('Website not reachable');html=String(result.data).slice(0,600000);headers=result.headers;reachable=true;}
  catch(e){if(e instanceof Error&&/public IPv4|public HTTPS|reserved domain/.test(e.message))throw e;}
  const lower=html.toLowerCase();let platform='manual';const config:Record<string,string>={};
  if(/blogspot\./.test(u.hostname)||/name=["']generator["'][^>]+blogger/i.test(html))platform='blogger';
  else if(headers['x-wix-request-id']||/wix\.com|wixstatic\.com/.test(lower))platform='wix';
  else if(/data-wf-site=/.test(lower)){platform='webflow';config.site_id=html.match(/data-wf-site=["']([^"']+)/i)?.[1]||'';}
  else if(u.hostname.endsWith('.myshopify.com')||/shopify\.shop\s*=|cdn\.shopify\.com/.test(lower)){platform='shopify';config.shop_domain=html.match(/Shopify\.shop\s*=\s*["']([^"']+)/i)?.[1]||u.hostname;}
  else if(/<meta[^>]+generator[^>]+ghost|ghost\/api\//i.test(html))platform='ghost';
  else if(/drupal/i.test(headers['x-generator']||'')||/name=["']generator["'][^>]+drupal/i.test(html))platform='drupal';
  else if(/name=["']generator["'][^>]+joomla/i.test(html))platform='joomla';
  else {
    try{const r=await request(u.href.replace(/\/$/,'')+'/wp-json/','GET',{},undefined,6000);if(r.data?.namespaces?.includes('wp/v2')){platform='wordpress';reachable=true;}}
    catch{/* A site without WordPress is never sent WordPress credentials. */}
    if(platform==='manual'&&(/wp-content\/|wp-includes\//.test(lower)||/api\.w\.org/.test(headers.link||'')))platform='wordpress';
  }
  // Check the documented generic endpoint independently of WordPress discovery.
  let customApi=false,browser:any=null,browserError='',browserPolicy='requires_configuration';
  try{const r=await request(u.origin+'/.well-known/guestpost','GET',{},undefined,4000);customApi=r.data?.protocol==='guestpost.v1';if(customApi&&platform==='manual'){platform='custom';config.connector_url=u.origin+'/.well-known/guestpost';}}catch{/* Not an installed native connector. */}
  try{const r=await request(u.origin+'/.well-known/guestpost-browser.json','GET',{},undefined,4000);const found=browserDiscovery(platform,r.data,u.href);browser=found.workflow;browserPolicy=found.policy;}catch(e){if(e instanceof Error&&!/HTTP|JSON|timed out|Redirect/.test(e.message))browserError='The browser connector manifest needs correction.';}
  if(!browser&&browserPolicy!=='not_permitted'&&platform==='wordpress'){const found=browserDiscovery(platform,null,u.href);browser=found.workflow;browserPolicy=found.policy;}
  const info=catalog.find(p=>p.id===platform)!;
  const unreachable='The public HTTPS website could not be reached. Check the domain, public DNS, HTTPS certificate and availability, then retry discovery. Publishing support has not been determined.';
  const report={native_api:platform==='manual'?'not_detected':'detected',platform_connector:platform==='manual'?'not_configured':'available',browser_workflow:browserPolicy,reachable,recommended_action:!reachable?unreachable:browser?'Connect a supported API credential, or authorize the configured browser workflow.':browserPolicy==='not_permitted'?'The destination prohibits browser automation. Use an authorized API connection or contact its administrator.':platform==='manual'?'Install an authorized API connector or a permitted browser workflow manifest.':info.guide,...(browserError?{browser_note:browserError}:{})};
  return {platform:platform==='manual'?'custom':platform,config,reachable,resolved_url:u.href.replace(/\/$/,''),name:u.hostname.replace(/^www\./,''),guide:!reachable?unreachable:info.guide,authentication:info.authentication,docs:info.docs,status:!reachable?'error':platform==='manual'?'setup_required':'authorization_required',browser,report};
}
function stringConfig(raw:any){
  if(typeof raw==='string'){if(raw.length>16000)throw fail('Advanced settings exceed their size limit.');try{raw=JSON.parse(raw||'{}');}catch{throw fail('Advanced connection settings must be valid JSON.');}}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  const containsSecret=(value:any):boolean=>value&&typeof value==='object'&&Object.entries(value).some(([key,v])=>/password|secret|token|authorization|credential/i.test(key)||containsSecret(v));
  if(containsSecret(raw))throw fail('Use the secure credential field for secrets. Advanced settings are not a secret store.');
  return raw as Record<string,any>;
}
function identifier(value:any,fallback=''){const v=text(value??fallback,200);if(v&&!/^[A-Za-z0-9_-]+$/.test(v))throw fail('A connection identifier contains unsupported characters.');return v;}
export function connectionSpec(url:string,platform:string,raw:any){
  const c=stringConfig(raw),u=canonicalURL(url),base=u.href.replace(/\/$/,'');const config:Record<string,any>={};let endpoint=base;
  if(platform==='wordpress'){
    endpoint=c.api_endpoint||base+'/wp-json/wp/v2';if(canonicalURL(endpoint).origin!==u.origin)throw fail('WordPress authorization must stay on this website’s origin.');
  } else if(platform==='ghost')endpoint=(c.admin_url?canonicalURL(c.admin_url).href.replace(/\/$/,''):base)+'/ghost/api/admin';
  else if(platform==='shopify'){
    const domain=String(c.shop_domain||u.hostname).replace(/^https:\/\//,'').replace(/\/$/,'').toLowerCase();
    if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain))throw fail('Enter the store’s myshopify.com domain.');
    endpoint='https://'+domain+'/admin/api/2026-10/graphql.json';config.shop_domain=domain;
    config.blog_id=String(c.blog_id||'').startsWith('gid://shopify/Blog/')?String(c.blog_id):'gid://shopify/Blog/'+identifier(c.blog_id);
    if(!/^gid:\/\/shopify\/Blog\/\d+$/.test(config.blog_id))throw fail('Choose a Shopify blog ID.');config.author_name=text(c.author_name||'Editorial Team',100);
    if(c.client_id)config.client_id=text(c.client_id,200,true);
    if(c.blog_handle)config.blog_handle=identifier(c.blog_handle);
  } else if(platform==='webflow'){
    endpoint='https://api.webflow.com/v2';config.collection_id=identifier(c.collection_id);config.body_field=identifier(c.body_field||'post-body');
    if(!config.collection_id)throw fail('Choose a Webflow CMS collection.');
    if(c.site_id)config.site_id=identifier(c.site_id);
    for(const k of ['image_field','meta_title_field','meta_description_field','canonical_field','locale_id'])if(c[k])config[k]=identifier(c[k]);
    config.public_path=text(c.public_path||'',1000,true);const sample=canonicalURL(config.public_path.replace('{slug}','article'));
    if(sample.origin!==u.origin||!config.public_path.includes('{slug}'))throw fail('The collection’s public URL must be on this website and include {slug}.');
    if(c.required_fields)config.required_fields=stringConfig(c.required_fields);
  } else if(platform==='blogger'){endpoint='https://www.googleapis.com/blogger/v3';if(c.blog_id)config.blog_id=identifier(c.blog_id);}
  else if(platform==='wix'){endpoint='https://www.wixapis.com';config.site_id=identifier(c.site_id);config.member_id=identifier(c.member_id);if(!config.site_id||!config.member_id)throw fail('Choose the Wix site ID and author member ID.');}
  else if(platform==='drupal'){endpoint=base+'/jsonapi';config.bundle=identifier(c.bundle,'article');config.text_format=identifier(c.text_format,'basic_html');if(c.extra_attributes)config.extra_attributes=stringConfig(c.extra_attributes);if(c.relationships)config.relationships=stringConfig(c.relationships);}
  else if(platform==='joomla'){endpoint=base+'/api/index.php/v1';config.category_id=integer(c.category_id,1,2147483647);config.content_language=text(c.content_language||'*',20);if(c.public_path){config.public_path=text(c.public_path,1000);if(canonicalURL(config.public_path.replace('{id}','1').replace('{slug}','article')).origin!==u.origin)throw fail('The article URL must be on this Joomla website.');}}
  else if(platform==='custom'){endpoint=canonicalURL(c.connector_url||base+'/.well-known/guestpost').href.replace(/\/$/,'');if(new URL(endpoint).origin!==u.origin)throw fail('The custom publishing connector must belong to this website.');}
  else if(platform!=='manual')throw fail('Choose a supported platform or manual publishing.');
  if(c.permission_endpoint){const permission=canonicalURL(c.permission_endpoint);if(permission.origin!==u.origin||permission.search)throw fail('The permission endpoint must use this website’s HTTPS origin without a query.');config.permission_endpoint=permission.href;}
  endpoint=canonicalURL(endpoint).href.replace(/\/$/,'');if(new URL(endpoint).search)throw fail('Publishing endpoints cannot contain a query string.');
  return {api_endpoint:endpoint,connector_config:config};
}
export async function testConnection(site:Website,credentials:any){
  const result=await connector(site,credentials).test();
  if(!result)throw new RemoteError('The publishing permission check returned no result. Configure the destination capability bridge.',400);
  return {permission_status:result.permission_status||'verified',message:result.message||'Publishing permission verified as '+result.account,account:result.account};
}
export async function connectWebsite(actor:any,b:any){
  const service=db();let input=String(b.website_url||'').trim();if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(input))input='https://'+input;const u=canonicalURL(input);u.search='';let website_url=u.href.replace(/\/$/,'');
  let old:any;
  if(b.id){const r=await service.from('websites').select('*').eq('id',b.id).eq('tenant_id',actor.tenant_id).single();old=r.data;if(!old)throw fail('Website not found in your workspace.');}
  if(old?.connection_method==='browser'&&!b.password)throw fail('Use Test connection to recheck this browser workflow, or provide fresh credentials to rotate it.');
  if(!old&&!b.authorized)throw fail('Confirm that you are authorized to publish to this website.');
  const discovery=await discover(website_url);
  if(discovery.reachable&&discovery.resolved_url)website_url=discovery.resolved_url;
  const cms_type=b.cms_type&&b.cms_type!=='auto'?String(b.cms_type):discovery!.platform;
  let spec:any,configurationError='';
  try{spec=connectionSpec(website_url,cms_type,{...(discovery?.config??{}),...stringConfig(b.connector_config),...(b.api_endpoint?{api_endpoint:b.api_endpoint}:{})});}
  catch(e){configurationError=e instanceof Error?e.message:'More connection details are required.';const safe=stringConfig(b.connector_config);spec={api_endpoint:cms_type==='webflow'?'https://api.webflow.com/v2':cms_type==='blogger'?'https://www.googleapis.com/blogger/v3':cms_type==='wix'?'https://www.wixapis.com':website_url,connector_config:safe};}
  const site:Website={id:old?.id||crypto.randomUUID(),website_url,cms_type,...spec,connection_method:'api',connection_version:(old?.connection_version||0)+1};
  const unchanged=old&&binding(old)===binding(site);
  let credentials=b.password?{username:text(b.username,254),password:text(b.password,4000,true),...(site.connector_config.client_id?{client_id:site.connector_config.client_id}:{})}:unchanged?await rpc('read_credentials',{p_website:site.id}):null;
  if(credentials?.connection_key&&credentials.connection_key!==binding(site))credentials=null;
  let result:any={connection_status:cms_type==='manual'?'manual':'authorization_required',permission_status:'unverified',message:configurationError||catalog.find(p=>p.id===cms_type)?.guide||'Connect using a supported authorization method.'};
  if(cms_type!=='manual'&&!configurationError&&credentials){
    try{const verified=await testConnection(site,credentials);result={...verified,connection_status:'connected'};}
    catch(e){result={connection_status:e instanceof RemoteError&&e.status===403?'limited':e instanceof RemoteError&&e.status===401?'authorization_required':'error',permission_status:'unverified',message:e instanceof RemoteError?e.message:'The connection could not be verified. Confirm its settings and try again.'};credentials=null;}
  }
  let checkBrowser=false;
  const workflow=discovery.browser;
  if(result.connection_status!=='connected'&&b.browser_authorized===true&&workflow&&b.password){
    site.connection_method='browser';site.api_endpoint=website_url;site.connector_config={browser_workflow:workflow};
    credentials={username:text(b.username,254,true),password:String(b.password)};
    result={connection_status:'checking',permission_status:'unverified',message:'The browser worker must verify the editorial workflow before this site can receive campaigns.'};checkBrowser=true;
  }else if(result.connection_status!=='connected'&&(cms_type==='manual'||!discovery.reachable||configurationError||!credentials)){
    result.connection_status=!discovery.reachable?'error':configurationError||!workflow&&cms_type==='custom'?'setup_required':'authorization_required';
    if(result.connection_status==='setup_required')result.message=configurationError||'No installed API or browser workflow was found. Configure an authorized connector; this website is not yet an automatic publishing target.';
  }
  if(old&&old.connection_status==='connected'&&!b.password&&old.connection_method==='browser')throw fail('Use Test connection to recheck this browser workflow, or provide fresh credentials to rotate it.');
  if(old&&binding({...old,connection_version:site.connection_version})!==binding(site)){const {count}=await service.from('publishing_jobs').select('id',{head:true,count:'exact'}).eq('website_id',old.id);if(count)throw fail('This connection has publishing history. Add a new connection to change its destination or publishing workflow.');}
  if(old)site.connection_version=await rpc('reserve_connection_version',{p_actor:actor.id,p_website:old.id});
  const payload={...site,connection_report:{...discovery.report,native_api:result.connection_status==='connected'?'verified':discovery.report.native_api,browser_workflow:checkBrowser?'queued':discovery.report.browser_workflow},tenant_id:actor.tenant_id,owner_id:old?.owner_id||actor.id,website_name:text(b.website_name||old?.website_name||discovery?.name||u.hostname,200,true),category:text(b.category??old?.category,100),language:text(b.language||old?.language||'en',20),status:b.status==='disabled'?'disabled':'active',min_interval_seconds:integer(b.min_interval_seconds??old?.min_interval_seconds??300,300,86400),connection_status:result.connection_status,permission_status:result.permission_status,connection_message:result.message,tested_at:result.connection_status==='connected'?new Date().toISOString():null,updated_at:new Date().toISOString()};
  const saved=old?await service.from('websites').update(payload).eq('id',site.id).eq('connection_version',site.connection_version).select('id').single():await service.from('websites').insert(payload).select('id').single();if(saved.error)throw fail(saved.error.code==='23505'?'This website is already in your workspace. Edit its existing connection.':'The website could not be saved. Refresh if another administrator changed its connection.');
  if(credentials&&(result.connection_status==='connected'||checkBrowser)){
    await rpc('store_connection_credentials',{p_website:site.id,p_version:site.connection_version,p_credentials:{...credentials,connection_key:binding(site),api_endpoint:site.api_endpoint}});
    const {error}=await service.from('websites').update({connection_status:result.connection_status,permission_status:result.permission_status,connection_message:result.message,tested_at:payload.tested_at,connector_config:site.connector_config}).eq('id',site.id).eq('connection_version',site.connection_version).select('id').single();if(error)throw fail('The connection result could not be saved. Refresh the connection before retrying.');
    if(checkBrowser)await rpc('enqueue_browser_check',{p_actor:actor.id,p_website:site.id});
  }else if(old&&!credentials)await rpc('revoke_credentials',{p_website:site.id}).then(async()=>{await service.from('websites').update({status:payload.status,connection_status:result.connection_status,connection_message:result.message}).eq('id',site.id);});
  return {id:site.id,platform:cms_type,status:result.connection_status,message:result.message,report:payload.connection_report,guide:catalog.find(p=>p.id===cms_type)?.guide,docs:catalog.find(p=>p.id===cms_type)?.docs};
}
