import {db,rpc,articleData,text,integer,uuid,canonicalURL} from './core.ts';
import {wixRichContent} from './additional-connectors.ts';
import catalog from './catalog.json' with {type:'json'};

export function validateArticleForSite(site:any,article:any){
  if(site.cms_type==='wix'){
    if(article.featured_image)throw new Error('Wix featured images need a Wix Media import. Remove this featured image for Wix targets or publish that version manually.');
    wixRichContent(article.content);
  }
  if(site.cms_type==='webflow'&&article.featured_image&&!site.connector_config.image_field)throw new Error('Map an image field for this Webflow connection before publishing a featured image.');
}
export async function campaignPlan(actor:any,b:any){
  const quantity=integer(b.quantity??b.website_ids?.length,1,500),interval=integer(b.interval??300,300,86400);
  const mode=['auto','manual','category'].includes(b.mode)?b.mode:'auto';
  let article:any;
  if(b.article_id){const {data}=await db().from('articles').select('*').eq('id',uuid(b.article_id)).eq('tenant_id',actor.tenant_id).eq('status','approved').single();if(!data)throw new Error('Select an approved article from this workspace.');article=data;}
  else article=articleData(b.article??{});
  if(!article.content.replace(/<[^>]*>/g,'').trim()&&!article.content.includes('<img'))throw new Error('Add article content before creating a campaign.');
  if(article.featured_image){const u=canonicalURL(article.featured_image);if(u.origin!==new URL(Deno.env.get('SUPABASE_URL')!).origin||!u.pathname.startsWith('/storage/v1/object/public/article-images/'+actor.tenant_id+'/'))throw new Error('Upload the featured image to this workspace.');}
  const category=text(b.category,100),language=text(b.language,20),platform=text(b.platform,30);
  if(mode==='category'&&!category)throw new Error('Choose a category for category-based allocation.');
  const connected=await rpc('eligible_websites',{p_actor:actor.id,p_content:article.content,p_category:category,p_language:language,p_platform:platform});
  const incompatible:string[]=[];
  const eligible=connected.filter((site:any)=>{try{validateArticleForSite(site,{...article,...(b.overrides?.[site.id]?articleData({...article,...b.overrides[site.id]}):{})});return true;}catch{incompatible.push(site.website_name);return false;}});
  const ids=(b.website_ids??[]).map(uuid);if(new Set(ids).size!==ids.length)throw new Error('Select each website only once.');
  let targets:any[];
  if(mode==='manual'||ids.length){
    if(ids.length!==quantity)throw new Error('The selected website count must match the requested publication quantity.');
    targets=ids.map((id:string)=>eligible.find((w:any)=>w.id===id));if(targets.some((w:any)=>!w))throw new Error('Some selected websites are no longer eligible. Refresh the campaign preview.');
  }else targets=eligible.slice(0,quantity);
  const overrides:Record<string,any>={};
  for(const [id,raw]of Object.entries(b.overrides??{})){
    uuid(id);if(!targets.some(w=>w.id===id))throw new Error('A content variant references an unselected website.');
    const v=raw as Record<string,any>;const clean=articleData({...article,...v});
    overrides[id]=Object.fromEntries(['title','content','meta_title','meta_description','category','tags','canonical_url'].filter(k=>k in v).map(k=>[k,(clean as any)[k]]));
  }
  for(const site of targets)validateArticleForSite(site,{...article,...overrides[site.id]});
  const proposed=new Date(b.start_time||Date.now());if(!Number.isFinite(proposed.getTime()))throw new Error('Choose a valid campaign start time.');
  const start=Math.max(Date.now(),proposed.getTime());
  const warnings=[...(incompatible.length?[incompatible.length+' websites were excluded because this article’s formatting or image needs manual publishing on those connections.']:[]),...new Set(targets.flatMap((w:any)=>{
    const p=catalog.find(p=>p.id===w.cms_type);const result=[];
    if(article.canonical_url&&!p?.canonical&&!w.connector_config?.canonical_field)result.push(`${p?.name||w.cms_type} does not provide this canonical setting automatically; review its site template or publish that version manually.`);
    if(w.permission_status!=='verified')result.push(`${p?.name||w.cms_type}: credentials are verified; the worker checks create and publish permission at dispatch.`);
    return result;
  }))];
  return {article,quantity,interval,mode,overrides,start_time:new Date(start).toISOString(),first_at:new Date(start+interval*1000).toISOString(),last_at:new Date(start+quantity*interval*1000).toISOString(),eligible_count:eligible.length,shortage:Math.max(0,quantity-targets.length),targets:targets.map((w:any)=>({id:w.id,website_name:w.website_name,website_url:w.website_url,cms_type:w.cms_type,category:w.category,language:w.language,permission_status:w.permission_status,tested_at:w.tested_at})),warnings};
}
export async function startCampaign(actor:any,b:any){
  if(!b.editorial_approved||!b.authorized)throw new Error('Review the article, variants and selected websites before starting.');
  const plan=await campaignPlan(actor,b);
  if(plan.shortage)throw new Error(`Only ${plan.eligible_count} eligible websites are available for ${plan.quantity} publications. Reduce the quantity or connect more websites.`);
  const args={p_actor:actor.id,p_name:text(b.campaign_name||plan.article.title,200,true),p_sites:plan.targets.map(w=>w.id),p_interval:plan.interval,p_start:plan.start_time,p_overrides:plan.overrides};
  const id=b.article_id?await rpc('create_campaign',{...args,p_article:uuid(b.article_id)}):await rpc('create_inline_campaign',{...args,p_article:plan.article,p_mode:plan.mode});
  return {id,first_at:plan.first_at,last_at:plan.last_at,total:plan.quantity};
}
