import {db,rpc,uuid,canonicalURL} from './core.ts';
import {request,RemoteError} from './network.ts';
import {parseDocument} from 'htmlparser2';
import {requirePermission,ownCampaign,auditActor,can} from './authorization.ts';

const normalize=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function textOf(node:any):string{return node.type==='text'?node.data:(node.children||[]).map(textOf).join(' ');}
export function inspectPublicPage(html:string,article:any,url:string){
 const doc=parseDocument(html),nodes:any[]=[];const visit=(n:any)=>{nodes.push(n);for(const c of n.children||[])visit(c);};visit(doc);
 const title=textOf(nodes.find(n=>n.name==='title')||{}).trim(),headings=nodes.filter(n=>n.name==='h1').map(textOf),body=normalize(textOf(nodes.find(n=>n.name==='body')||doc));
 const expected=normalize(textOf(parseDocument(article.content||''))).slice(0,160),wanted=normalize(article.title||'');
 const source=parseDocument(article.content||''),sourceNodes:any[]=[];const walk=(n:any)=>{sourceNodes.push(n);for(const c of n.children||[])walk(c);};walk(source);
 const intended=sourceNodes.filter(n=>n.name==='a'&&/^https:\/\//i.test(n.attribs?.href||'')).map(n=>({href:n.attribs.href,anchor:normalize(textOf(n))}));
 const links=nodes.filter(n=>n.name==='a'&&n.attribs?.href).map(n=>({href:new URL(n.attribs.href,url).href,anchor:textOf(n).trim(),rel:n.attribs.rel||''}));
 const missing=intended.filter(a=>!links.some(l=>l.href===new URL(a.href,url).href&&normalize(l.anchor)===a.anchor));
 const titleMatches=headings.some(h=>normalize(h)===wanted)||normalize(title).includes(wanted),contentMatches=expected.length>=40&&body.includes(expected);
 return {verified:!!titleMatches&&contentMatches&&!missing.length,page_title:title,content_matches:contentMatches,title_matches:titleMatches,missing_backlinks:missing.length,backlinks:links.filter(l=>intended.some(i=>new URL(i.href,url).href===l.href)),canonical:nodes.find(n=>n.name==='link'&&n.attribs?.rel==='canonical')?.attribs?.href||null,indexability:nodes.some(n=>n.name==='meta'&&/robots/i.test(n.attribs?.name||'')&&/noindex/i.test(n.attribs?.content||''))?'noindex':'not_declared_noindex'};
}
export async function verifyPublicPublication(url:string,article:any,remoteId:unknown){
 const u=canonicalURL(url);if((u.pathname==='/'||u.pathname==='')&&!u.search)return {verified:false,status:'pending',code:'exact_article_url_required',http_status:null};if(!remoteId)return {verified:false,status:'pending',code:'remote_publication_id_missing',http_status:null};
 try{let current=u,result:any;for(let n=0;n<3;n++){try{result=await request(current.href,'GET',{},undefined,12000,'text');break;}catch(e){if(!(e instanceof RemoteError)||!e.location||n===2)throw e;const next=canonicalURL(new URL(e.location,current).href);if(next.origin!==u.origin)throw e;current=next;}}
  if(!result)return {verified:false,status:'pending',code:'no_public_response',http_status:null};const inspection=inspectPublicPage(String(result.data),article,current.href);return {...inspection,status:inspection.verified?'verified':'pending',http_status:result.status,checked_url:current.href,code:inspection.verified?'public_content_verified':'public_content_mismatch'};
 }catch(e){return {verified:false,status:e instanceof RemoteError&&[404,410].includes(e.status)?'unavailable':'pending',http_status:e instanceof RemoteError&&e.status?e.status:null,code:'public_page_unavailable'};}
}
export async function processReportVerification(){const task=await rpc('claim_report_verification');if(!task)return {processed:0};const result=await verifyPublicPublication(task.item.published_url,task.article,task.job.remote_post_id);await rpc('finish_report_verification',{p_item:task.item.id,p_token:task.item.lease_token,p_result:result});return {processed:1,verified:result.verified};}
export async function reportData(actor:any,id:unknown){
 requirePermission(actor,'reports.view');const service=db(),{data:report}=await service.from('publication_reports').select('*').eq('id',uuid(id)).eq('tenant_id',actor.tenant_id).single();if(!report)throw new Error('Report not found in this workspace.');const campaign=await ownCampaign(actor,report.campaign_id);
 const {data:items,error}=await service.from('publication_report_items').select('*').eq('report_id',report.id).eq('tenant_id',actor.tenant_id).order('created_at');if(error)throw new Error('Report results could not be loaded.');
 const {data:jobs}=await service.from('publishing_jobs').select('id,website_id,target_snapshot,published_at,status,overrides').eq('campaign_id',campaign.id).eq('tenant_id',actor.tenant_id);const rows=(items||[]).map((i:any)=>{const j=jobs?.find((x:any)=>x.id===i.job_id),site=j?.target_snapshot||{};return {id:i.id,job_id:i.job_id,campaign_id:campaign.id,campaign_name:campaign.campaign_name,article_title:j?.overrides?.title||campaign.article_snapshot.title,website_name:site.website_name||new URL(site.website_url||'https://unknown.invalid').hostname,domain:new URL(site.website_url||'https://unknown.invalid').hostname,platform:site.cms_type||'unknown',published_url:i.published_url,published_at:j?.published_at,status:i.verification_status,verified_at:i.verified_at,http_status:i.http_status,page_title:i.page_title,verification_details:i.verification_details,check_status:i.check_status};});
 return {report,campaign:{id:campaign.id,name:campaign.campaign_name,client_name:campaign.client_name,project_name:campaign.project_name,article_title:campaign.article_snapshot.title,status:campaign.status,assigned_to:campaign.assigned_to},items:rows};
}
export const reportActions=new Set(['report.list','report.detail','report.refresh','report.export','report.share','report.revoke','report.shares']);
export async function reportAction(actor:any,action:string,b:any){
 const service=db();requirePermission(actor,'reports.view');
 if(action==='report.list'){
  const {data,error}=await service.from('publication_reports').select('*').eq('tenant_id',actor.tenant_id).order('generated_at',{ascending:false});if(error)throw new Error('Reports could not be loaded.');const reports=[];
  for(const r of data||[]){try{const c=await ownCampaign(actor,r.campaign_id);reports.push({...r,campaign_name:c.campaign_name,client_name:c.client_name,article_title:c.article_snapshot.title,campaign_status:c.status});}catch{/* Other employees' campaigns are not listed. */}}
  return {reports};
 }
 if(action==='report.revoke'){requirePermission(actor,'reports.share');const {data:share}=await service.from('shared_reports').select('id,report_id').eq('id',uuid(b.id)).eq('tenant_id',actor.tenant_id).single();if(!share)throw new Error('Share not found.');await reportData(actor,share.report_id);const {error}=await service.from('shared_reports').update({revoked_at:new Date().toISOString()}).eq('id',share.id);if(error)throw new Error('Share could not be revoked.');await auditActor(actor,'report_share_revoked','Read-only client report link revoked.');return {ok:true};}
 const result=await reportData(actor,b.id);
 if(action==='report.detail')return result;
 if(action==='report.shares'){requirePermission(actor,'reports.share');const {data,error}=await service.from('shared_reports').select('id,created_at,expires_at,revoked_at').eq('report_id',result.report.id).eq('tenant_id',actor.tenant_id);if(error)throw new Error('Report shares could not be loaded.');return {shares:data};}
 if(action==='report.refresh'){const {error}=await service.from('publication_report_items').update({check_status:'queued',verification_attempts:0,next_check_at:new Date().toISOString()}).eq('report_id',result.report.id).not('published_url','is',null).neq('check_status','checking');if(error)throw new Error('Verification could not be queued.');await auditActor(actor,'report_verification_requested','Public link rechecks queued for a campaign report.');return {message:'Public verification queued. Results update through the backend worker.'};}
 if(action==='report.export'){requirePermission(actor,'reports.export');await auditActor(actor,'report_exported','Campaign publication report exported as '+String(b.format||'data').replace(/[^a-z]/g,'').slice(0,10)+'.');return result;}
 if(action==='report.share'){
  requirePermission(actor,'reports.share');const ids=(b.item_ids||[]).map(uuid);if(!ids.length||new Set(ids).size!==ids.length)throw new Error('Select the verified results to share.');const rows=result.items.filter((i:any)=>ids.includes(i.id));if(rows.length!==ids.length||rows.some((i:any)=>i.status!=='verified'||!i.published_url))throw new Error('Only selected publicly verified publications can be shared.');
  let employee; if(b.include_employee===true){requirePermission(actor,'users.read');if(result.campaign.assigned_to){const {data:p}=await service.from('profiles').select('full_name').eq('id',result.campaign.assigned_to).eq('tenant_id',actor.tenant_id).single();employee=p?.full_name;}}
  const raw=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join(''),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const expires=b.expires_at?new Date(b.expires_at):null;if(expires&&(!Number.isFinite(expires.getTime())||expires.getTime()<=Date.now()))throw new Error('Choose a future share expiration.');
  const snapshot={campaign_name:result.campaign.name,client_name:result.campaign.client_name,article_title:result.campaign.article_title,generated_at:new Date().toISOString(),...(employee?{assigned_employee:employee}:{}),items:rows.map((r:any)=>({website:r.website_name,domain:r.domain,article_title:r.article_title,published_url:canonicalURL(r.published_url).href,published_at:r.published_at,verified_at:r.verified_at,status:'verified',platform:r.platform}))};
  const {data:s,error}=await service.from('shared_reports').insert({tenant_id:actor.tenant_id,report_id:result.report.id,created_by:actor.id,token_hash:hash,snapshot,expires_at:expires?.toISOString()||null}).select('id').single();if(error)throw new Error('Client report link could not be created.');await auditActor(actor,'report_shared','A revocable read-only snapshot was created for selected verified publications.');return {id:s.id,url:'https://zeshanayub044-sudo.github.io/guestpostsaas/#client-report='+raw,expires_at:expires?.toISOString()||null};
 }
 throw new Error('Unknown report operation.');
}
