import {db,rpc,text,uuid,canonicalURL} from './core.ts';
import {discover} from './connections.ts';

export function importRow(raw:any,index:number){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {row_number:index+2,status:'invalid',error_code:'invalid_row',message:'This row is not a website record.'};
  if(Object.keys(raw).some(k=>/password|passwd|passcode|secret|token|credential|api.?key|authorization|cookie|session|^pwd$|^pass$/i.test(k)))throw new Error('Remove credential columns. Spreadsheet import accepts inventory only.');
  const r:any={row_number:index+2,status:'pending',website_url:'',website_name:'',category:'',language:'en',country:'',account_email:'',cms_hint:''};
  try{
    let url=text(raw.website_url,2000,true);if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(url))url='https://'+url;
    const u=new URL(url);u.hash='';u.search='';canonicalURL(u.href);r.website_url=u.href.replace(/\/$/,'');r.domain=u.hostname.replace(/^www\./,'');
    r.website_name=text(raw.website_name||u.hostname,200,true);r.account_email=text(raw.account_email,254);r.category=text(raw.category,100);r.language=text(raw.language||'en',20);r.country=text(raw.country,100);r.cms_hint=text(raw.cms_type,40);
  }catch(e){r.status='invalid';r.error_code='invalid_inventory_row';r.message=e instanceof Error?e.message:'Website details are invalid.';}
  return r;
}
export async function importInventory(actor:any,b:any){
  if(!b.inventory_confirmed&&!b.authorized)throw new Error('Confirm that you may manage this website inventory. Import does not grant publishing permission.');
  if(!Array.isArray(b.rows)||b.rows.length<1||b.rows.length>500)throw new Error('Import 1–500 website rows.');
  const rows=b.rows.map(importRow),seen=new Set();for(const r of rows){if(r.status==='pending'){if(seen.has(r.domain)){r.status='duplicate';r.message='Duplicate domain in this spreadsheet.';r.error_code='duplicate_domain';}else seen.add(r.domain);}}
  return rpc('import_website_inventory',{p_actor:actor.id,p_request:uuid(b.request_id||crypto.randomUUID()),p_filename:text(b.filename||'Website import',200,true),p_rows:rows});
}
export async function processDiscovery(){
  const row=await rpc('claim_import_discovery');if(!row)return {processed:0};
  try{const result=await discover(row.website_url);await rpc('finish_import_discovery',{p_row:row.id,p_token:row.lease_token,p_result:result});return {processed:1};}
  catch{await rpc('finish_import_discovery',{p_row:row.id,p_token:row.lease_token,p_result:{error:true,message:'Secure discovery could not reach this website. Check its public HTTPS availability and retry.',code:'discovery_failed'}});return {processed:1};}
}
export async function retryDiscovery(actor:any,id:unknown){
  const service=db(),{data:batch,error}=await service.from('import_batches').select('id').eq('id',uuid(id)).eq('tenant_id',actor.tenant_id).single();if(error||!batch)throw new Error('Import batch not found.');
  const {error:updateError}=await service.from('import_rows').update({status:'pending',lease_token:null,lease_until:null,error_code:null,message:'Discovery queued again.'}).eq('batch_id',batch.id).eq('status','error').lt('attempts',3);if(updateError)throw new Error('Discovery retry could not be queued.');return {message:'Eligible discovery failures queued again, up to three attempts per row.'};
}
