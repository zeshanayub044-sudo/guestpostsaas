import {request,RemoteError} from './network.ts';
import {rpc,canonicalURL,cleanHTML,text} from './core.ts';
import {WordPress} from './wordpress.ts';

export type Website={id:string;website_url:string;api_endpoint:string;cms_type:string;connector_config:Record<string,any>;connection_method?:string;connection_version?:number};
export type Credential=Record<string,any>;
export type Runtime={http:typeof request;checkpoint:typeof rpc;now:()=>number};
const defaultRuntime:Runtime={http:request,checkpoint:rpc,now:()=>Date.now()};
const b64=(s:string)=>btoa(unescape(encodeURIComponent(s)));
const segment=(s:any)=>encodeURIComponent(String(s));
export function binding(site:Website){const value:any[]=[site.cms_type,site.website_url,site.api_endpoint,Object.entries(site.connector_config??{}).sort(([a],[b])=>a.localeCompare(b))];if(site.connection_method==='browser')value.push('browser',site.connection_version);return JSON.stringify(value);}
export function confirmation(site:Website,id:any,url:any,extra:Record<string,unknown>={}){
  const u=canonicalURL(url);
  if(u.origin!==new URL(site.website_url).origin)throw new RemoteError('The platform returned a publication URL outside the connected website.',0,0,true);
  return {url:u.href,info:{id:String(id),platform:site.cms_type,...extra}};
}
abstract class Base {
  protected end:number;
  constructor(protected site:Website,protected credentials:Credential,protected rt:Runtime=defaultRuntime){canonicalURL(site.api_endpoint);this.end=rt.now()+85000;}
  protected async http(path:string,method='GET',headers:Record<string,string>={},body?:any){
    const remaining=this.end-this.rt.now();if(remaining<=0)throw new RemoteError('The publishing request exceeded its time budget.');
    return this.rt.http(this.site.api_endpoint.replace(/\/$/,'')+path,method,{'Content-Type':'application/json',...headers},body===undefined?undefined:JSON.stringify(body),Math.min(20000,remaining));
  }
  protected async remember(job:any,id:any){
    id=String(id??'');if(!/^[A-Za-z0-9:/_.-]{1,300}$/.test(id))throw new RemoteError('The platform did not return a valid draft identifier.',0,0,true);
    if(!await this.rt.checkpoint('save_remote_id',{p_job:job.id,p_token:job.lease_token,p_remote_id:id}))throw new RemoteError('The draft identifier could not be saved. Reconcile before retrying.',0,0,true);
    job.remote_post_id=id;return id;
  }
  protected async mark(job:any){if(!await this.rt.checkpoint('mark_remote_attempt',{p_job:job.id,p_token:job.lease_token}))throw new Error('Worker lease expired.');job.remote_attempt_started=true;}
  protected unresolved(){return new RemoteError('A previous create request has an unknown outcome. Inspect the remote drafts and trash before retrying; another draft will not be created automatically.',0,0,true);}
  abstract test():Promise<any>;
  abstract publish(job:any,article:any):Promise<any>;
}
export async function ghostToken(key:string,now=Date.now()){
  const [id,secret]=key.split(':');if(!/^[a-f0-9]{12,64}$/i.test(id??'')||!/^([a-f0-9]{2}){16,64}$/i.test(secret??''))throw new RemoteError('Use a Ghost Admin integration key.',401);
  const encode=(v:unknown)=>b64(JSON.stringify(v)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const header=encode({alg:'HS256',typ:'JWT',kid:id}),payload=encode({iat:Math.floor(now/1000),exp:Math.floor(now/1000)+300,aud:'/admin/'});
  const bytes=new Uint8Array(secret.match(/../g)!.map(s=>parseInt(s,16)));
  const cryptoKey=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=new Uint8Array(await crypto.subtle.sign('HMAC',cryptoKey,new TextEncoder().encode(header+'.'+payload)));
  return header+'.'+payload+'.'+btoa(String.fromCharCode(...signature)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export class Ghost extends Base {
  private async call(path:string,method='GET',body?:any){return this.http(path,method,{Authorization:'Ghost '+await ghostToken(this.credentials.password,this.rt.now()),'Accept-Version':'v5.0'},body);}
  async test(){await this.call('/posts/?limit=1&fields=id,title,status');return {account:'Ghost custom integration',permission_status:'credential_verified',message:'Admin integration connected. Publishing permission is checked again when a job runs.'};}
  async publish(job:any,a:any){
    let id=job.remote_post_id;
    if(!id&&(job.remote_attempt_started||job.needs_reconciliation)){
      let post;try{post=(await this.call('/posts/slug/'+segment(job.remote_slug)+'/')).data.posts?.[0];}catch(e){if(!(e instanceof RemoteError&&e.status===404))throw e;}
      if(!post||post.slug!==job.remote_slug)throw this.unresolved();id=await this.remember(job,post.id);
    }
    if(!id){
      await this.mark(job);
      const {data}=await this.call('/posts/?source=html','POST',{posts:[{title:a.title,html:'<!--kg-card-begin: html-->'+cleanHTML(a.content)+'<!--kg-card-end: html-->',slug:job.remote_slug,status:'draft',visibility:'public',...(a.featured_image?{feature_image:a.featured_image}:{}),meta_title:a.meta_title||null,meta_description:a.meta_description||null,canonical_url:a.canonical_url||null}]});
      id=await this.remember(job,data.posts?.[0]?.id);
    }
    let post=(await this.call('/posts/'+segment(id)+'/')).data.posts?.[0];
    if(post?.status!=='published')post=(await this.call('/posts/'+segment(id)+'/','PUT',{posts:[{status:'published',updated_at:post?.updated_at}]})).data.posts?.[0];
    if(post?.status!=='published'||String(post.id)!==String(id))throw new RemoteError('Ghost did not confirm publication.',0,0,true);
    return confirmation(this.site,id,post.url,{status:post.status});
  }
}
export class Shopify extends Base {
  private token?:string;
  private async graph(query:string,variables:Record<string,unknown>={}){
    if(!this.token){
      if(this.credentials.client_id){
        const u=new URL(this.site.api_endpoint);const {data}=await this.rt.http(u.origin+'/admin/oauth/access_token','POST',{'Content-Type':'application/x-www-form-urlencoded'},new URLSearchParams({grant_type:'client_credentials',client_id:this.credentials.client_id,client_secret:this.credentials.password}).toString());
        if(!data.access_token)throw new RemoteError('Shopify authorization failed. Confirm that the installed app and store share an organization.',401);this.token=data.access_token;
      }else this.token=this.credentials.password;
    }
    const {data}=await this.http('','POST',{'X-Shopify-Access-Token':this.token!},{query,variables});
    if(data.errors?.length)throw new RemoteError('Shopify rejected the request. Check app scopes, the blog and API rate limits.',data.errors.some((e:any)=>e.extensions?.code==='THROTTLED')?429:400,300);
    return data.data;
  }
  async test(){
    const c=this.site.connector_config;
    const data=await this.graph('query($id:ID!){currentAppInstallation{accessScopes{handle}} shop{name primaryDomain{url}} blog(id:$id){id title handle}}',{id:c.blog_id});
    if(!data.blog)throw new RemoteError('Choose an existing Shopify blog.',400);
    if(!data.currentAppInstallation.accessScopes.some((s:any)=>['write_content','write_online_store_pages'].includes(s.handle)))throw new RemoteError('The Shopify app needs permission to write blog content.',403);
    if(new URL(data.shop.primaryDomain.url).origin!==new URL(this.site.website_url).origin)throw new RemoteError('The Shopify store does not match the connected public website.',400);
    c.blog_handle=data.blog.handle;return {account:data.shop.name+' / '+data.blog.title,permission_status:'verified',message:'Shopify content permission verified.'};
  }
  async publish(job:any,a:any){
    const c=this.site.connector_config;let id=job.remote_post_id;
    if(!id&&(job.remote_attempt_started||job.needs_reconciliation)){
      const found=await this.graph('query($q:String!){articles(first:2,query:$q){nodes{id handle isPublished blog{id handle}}}}',{q:'blog_id:'+String(c.blog_id).split('/').pop()+' AND handle:'+job.remote_slug});
      const posts=found.articles.nodes.filter((p:any)=>p.handle===job.remote_slug&&p.blog.id===c.blog_id);
      if(posts.length!==1)throw this.unresolved();id=await this.remember(job,posts[0].id);
    }
    if(!id){
      const metafields=[...(a.meta_title?[{namespace:'global',key:'title_tag',type:'single_line_text_field',value:a.meta_title}]:[]),...(a.meta_description?[{namespace:'global',key:'description_tag',type:'single_line_text_field',value:a.meta_description}]:[])];
      await this.mark(job);
      const d=await this.graph('mutation($a:ArticleCreateInput!){articleCreate(article:$a){article{id handle} userErrors{field message}}}',{a:{blogId:c.blog_id,title:a.title,author:{name:c.author_name||'Editorial Team'},body:cleanHTML(a.content),handle:job.remote_slug,isPublished:false,summary:a.meta_description,tags:a.tags,...(metafields.length?{metafields}:{}),...(a.featured_image?{image:{url:a.featured_image,altText:a.title}}:{})}});
      if(d.articleCreate.userErrors?.length)throw new RemoteError('Shopify could not create the article. Check required blog fields and image requirements.',400);
      id=await this.remember(job,d.articleCreate.article?.id);
    }
    const d=await this.graph('mutation($id:ID!){articleUpdate(id:$id,article:{isPublished:true}){article{id handle isPublished publishedAt blog{handle}} userErrors{field message}}}',{id});
    const post=d.articleUpdate.article;if(d.articleUpdate.userErrors?.length||!post?.isPublished||!post.publishedAt||post.id!==id)throw new RemoteError('Shopify did not confirm article publication.',0,0,true);
    return confirmation(this.site,id,new URL('/blogs/'+segment(post.blog.handle)+'/'+segment(post.handle),this.site.website_url).href,{status:'published'});
  }
}
export class Webflow extends Base {
  private call(path:string,method='GET',body?:any){return this.http(path,method,{Authorization:'Bearer '+this.credentials.password},body);}
  async test(){
    const c=this.site.connector_config;const {data}=await this.call('/collections/'+segment(c.collection_id));
    if(!data.fields?.some((f:any)=>f.slug===c.body_field&&f.type==='RichText'))throw new RemoteError('Choose the collection field that stores the article’s rich text.',400);
    const known=new Set(['name','slug',c.body_field,c.image_field,c.meta_title_field,c.meta_description_field,c.canonical_field,...Object.keys(c.required_fields??{})]);
    if(data.fields.some((f:any)=>f.isRequired&&!known.has(f.slug)))throw new RemoteError('This collection has additional required fields. Add their values in advanced connection settings.',400);
    return {account:data.displayName||data.slug,permission_status:'credential_verified',message:'Collection and content field verified. Token must include CMS write permission; publication is checked at dispatch.'};
  }
  async publish(job:any,a:any){
    const c=this.site.connector_config,path='/collections/'+segment(c.collection_id)+'/items';let id=job.remote_post_id;
    if(!id&&(job.remote_attempt_started||job.needs_reconciliation)){
      const {data}=await this.call(path+'?slug='+segment(job.remote_slug));const found=(data.items??[]).filter((p:any)=>p.fieldData?.slug===job.remote_slug);
      if(found.length!==1)throw this.unresolved();id=await this.remember(job,found[0].id);
    }
    if(!id){
      const fieldData:any={...(c.required_fields??{}),name:a.title,slug:job.remote_slug,[c.body_field]:cleanHTML(a.content)};
      for(const [field,value]of [[c.image_field,a.featured_image],[c.meta_title_field,a.meta_title],[c.meta_description_field,a.meta_description],[c.canonical_field,a.canonical_url]])if(field&&value)fieldData[String(field)]=field===c.image_field?{url:value,alt:a.title}:value;
      await this.mark(job);const {data}=await this.call(path+'/insert?skipInvalidFiles=false','POST',{items:[{isDraft:true,isArchived:false,fieldData,...(c.locale_id?{cmsLocaleIds:[c.locale_id]}:{})}]});id=await this.remember(job,data.items?.[0]?.id);
    }
    const sent=(await this.call(path+'/publish','POST',{itemIds:[id]})).data;
    if(!sent.publishedItemIds?.includes(id)||sent.errors?.length)throw new RemoteError('Webflow did not confirm the selected item’s publication.',0,0,true);
    const live=(await this.call(path+'/'+segment(id)+'/live')).data;
    if(live.id!==id||live.isDraft||live.isArchived||live.fieldData?.slug!==job.remote_slug)throw new RemoteError('The Webflow item is not available in the live collection.',0,0,true);
    return confirmation(this.site,id,c.public_path.replace('{slug}',segment(live.fieldData.slug)),{status:'published'});
  }
}

export {Base,segment,b64,defaultRuntime};
