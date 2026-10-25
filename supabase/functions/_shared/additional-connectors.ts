import {Base,segment,b64,confirmation,Website,Credential,Runtime} from './connectors.ts';
import {RemoteError} from './network.ts';
import {cleanHTML} from './core.ts';
import {parseDocument} from 'htmlparser2';
import {permissionBridge} from './capabilities.ts';

export class Drupal extends Base {
  private call(path:string,method='GET',body?:any){return this.http(path,method,{Authorization:'Basic '+b64(this.credentials.username+':'+this.credentials.password),'Content-Type':'application/vnd.api+json',Accept:'application/vnd.api+json'},body);}
  async test(){
    const result=await this.call('/node/'+segment(this.site.connector_config.bundle)+'?page[limit]=1');if(!Array.isArray(result.data?.data))throw new RemoteError('The website did not return a Drupal JSON:API resource list.',400);
    try{return await permissionBridge(this.site,{Authorization:'Basic '+b64(this.credentials.username+':'+this.credentials.password)},this.rt);}
    catch(e){if(e instanceof RemoteError&&e.status===404)throw new RemoteError('Drupal JSON:API is available, but public reads do not verify this account. Install the included GuestPost permissions module, enable JSON:API writes, and grant this account create and direct publish access.',400);throw e;}
  }
  async publish(job:any,a:any){
    const c=this.site.connector_config,path='/node/'+segment(c.bundle),target=path+'/'+segment(job.id);let id=job.remote_post_id;
    if(!id&&(job.remote_attempt_started||job.needs_reconciliation)){
      let post;try{post=(await this.call(target)).data.data;}catch(e){if(!(e instanceof RemoteError&&e.status===404))throw e;}
      if(post?.id!==job.id)throw this.unresolved();id=await this.remember(job,post.id);
    }
    if(!id){
      await this.mark(job);
      const {data}=await this.call(path,'POST',{data:{type:'node--'+c.bundle,id:job.id,attributes:{...(c.extra_attributes??{}),title:a.title,body:{value:cleanHTML(a.content),format:c.text_format},status:false},...(c.relationships?{relationships:c.relationships}:{})}});
      if(data.data?.id!==job.id)throw new RemoteError('Drupal returned an unexpected article identifier.',0,0,true);id=await this.remember(job,data.data.id);
    }
    const {data}=await this.call(path+'/'+segment(id),'PATCH',{data:{type:'node--'+c.bundle,id,attributes:{status:true}}});
    const post=data.data;
    if(post?.id!==id||post.attributes?.status!==true)throw new RemoteError('Drupal did not confirm published status. Check its moderation workflow.',0,0,true);
    const alias=post.attributes.path?.alias,nid=post.attributes.drupal_internal__nid;
    if(!alias&&!Number.isInteger(nid))throw new RemoteError('Drupal did not return an article URL or node number.',0,0,true);
    return confirmation(this.site,id,new URL(alias||'/node/'+nid,this.site.website_url).href,{status:'published'});
  }
}
export class Joomla extends Base {
  private call(path:string,method='GET',body?:any){return this.http(path,method,{'X-Joomla-Token':this.credentials.password,Accept:'application/vnd.api+json'},body);}
  async test(){const {data}=await this.call('/content/articles?page[limit]=1');if(!Array.isArray(data?.data))throw new RemoteError('The website did not return a Joomla Web Services article list.',400);const verified=await permissionBridge(this.site,{'X-Joomla-Token':this.credentials.password},this.rt);return verified||{account:'Joomla API account',permission_status:'credential_verified',message:'Joomla API login verified. Configure a same-site permission bridge to check core.create, core.edit and core.edit.state for the selected category; read access alone cannot qualify this account for campaigns.'};}
  async publish(job:any,a:any){
    const c=this.site.connector_config;let id=job.remote_post_id;
    if(!id&&(job.remote_attempt_started||job.needs_reconciliation)){
      const {data}=await this.call('/content/articles?filter[search]='+segment(job.remote_slug)+'&page[limit]=100');
      const found=(data.data??[]).filter((p:any)=>p.attributes?.alias===job.remote_slug&&String(p.attributes.catid)===String(c.category_id));
      if(found.length!==1)throw this.unresolved();id=await this.remember(job,found[0].id);
    }
    if(!id){
      await this.mark(job);const {data}=await this.call('/content/articles','POST',{title:a.title,alias:job.remote_slug,articletext:cleanHTML(a.content),catid:Number(c.category_id),language:c.content_language||'*',state:0});id=await this.remember(job,data.data?.id);
    }
    await this.call('/content/articles/'+segment(id),'PATCH',{id:Number(id),state:1});
    const {data}=await this.call('/content/articles/'+segment(id));const p=data.data?.attributes;
    if(Number(p?.state)!==1)throw new RemoteError('Joomla did not confirm published status. Check the content workflow.',0,0,true);
    const url=c.public_path?c.public_path.replace('{slug}',segment(p.alias)).replace('{id}',segment(id)):new URL('/index.php?option=com_content&view=article&id='+segment(id),this.site.website_url).href;
    return confirmation(this.site,id,url,{status:'published'});
  }
}
export class Blogger extends Base {
  private access?:string;
  private async call(path:string,method='GET',body?:any){
    if(!this.access){
      if(this.credentials.refresh_token){
        const {data}=await this.rt.http('https://oauth2.googleapis.com/token','POST',{'Content-Type':'application/x-www-form-urlencoded'},new URLSearchParams({grant_type:'refresh_token',client_id:Deno.env.get('GOOGLE_CLIENT_ID')||'',client_secret:Deno.env.get('GOOGLE_CLIENT_SECRET')||'',refresh_token:this.credentials.refresh_token}).toString());
        if(!data.access_token)throw new RemoteError('Reconnect Google to renew Blogger authorization.',401);if(data.scope&&!String(data.scope).split(' ').includes('https://www.googleapis.com/auth/blogger'))throw new RemoteError('Google granted read-only access. Reconnect with Blogger publishing permission.',403);this.access=data.access_token;
      }else this.access=this.credentials.access_token;
    }
    return this.http(path,method,{Authorization:'Bearer '+this.access},body);
  }
  async test(){
    if(!String(this.credentials.scope||'').split(' ').includes('https://www.googleapis.com/auth/blogger'))throw new RemoteError('Reconnect Google and approve the Blogger publishing scope. Google identity or read-only blog access is insufficient.',403);
    const {data}=await this.call('/users/self/blogs?view=AUTHOR');const blog=(data.items??[]).find((b:any)=>String(b.id)===String(this.site.connector_config.blog_id));
    if(!blog||new URL(blog.url).hostname!==new URL(this.site.website_url).hostname)throw new RemoteError('The Google account cannot author the selected Blogger website.',403);
    return {account:blog.name,permission_status:'verified',message:'Google Blogger authorization verified.'};
  }
  async publish(job:any,a:any){
    const path='/blogs/'+segment(this.site.connector_config.blog_id)+'/posts',marker='guestpost-'+job.id;let id=job.remote_post_id;
    if(!id&&(job.remote_attempt_started||job.needs_reconciliation)){
      const {data}=await this.call(path+'?view=ADMIN&status=DRAFT&status=LIVE&status=SCHEDULED&labels='+segment(marker)+'&maxResults=100');const posts=(data.items??[]).filter((p:any)=>p.labels?.includes(marker));
      if(posts.length!==1)throw this.unresolved();id=await this.remember(job,posts[0].id);
    }
    if(!id){await this.mark(job);const {data}=await this.call(path+'?isDraft=true','POST',{kind:'blogger#post',title:a.title,content:cleanHTML(a.content),labels:[...(a.tags??[]).slice(0,19),marker]});id=await this.remember(job,data.id);}
    const existing=(await this.call(path+'/'+segment(id)+'?view=ADMIN')).data;
    const post=existing.status==='LIVE'?existing:(await this.call(path+'/'+segment(id)+'/publish','POST',{})).data;
    if(post.status!=='LIVE'||String(post.id)!==String(id))throw new RemoteError('Blogger did not confirm a live publication.',0,0,true);
    return confirmation(this.site,id,post.url,{status:'published'});
  }
}
export class Custom extends Base {
  private call(path:string,method='GET',body?:any){return this.http(path,method,{Authorization:'Bearer '+this.credentials.password},body);}
  async test(){
    const {data}=await this.call('/capabilities');
    if(data.protocol!=='guestpost.v1'||data.permissions?.publish!==true||data.idempotency!==true)throw new RemoteError('This endpoint does not implement the authorized GuestPost publishing contract. Use manual publishing or ask its developer to install a connector.',400);
    return {account:data.account||'Custom publisher',permission_status:'verified',message:'Publishing permission and idempotency contract verified.'};
  }
  async publish(job:any,a:any){
    let id=job.remote_post_id;
    if(!id&&(job.remote_attempt_started||job.needs_reconciliation)){
      let post;try{post=(await this.call('/publications/by-key/'+segment(job.id))).data;}catch(e){if(!(e instanceof RemoteError&&e.status===404))throw e;}
      if(!post?.id||post.idempotency_key!==job.id)throw this.unresolved();id=await this.remember(job,post.id);
    }
    if(!id){await this.mark(job);const {data}=await this.call('/drafts','POST',{idempotency_key:job.id,article:{...a,content:cleanHTML(a.content),slug:job.remote_slug}});id=await this.remember(job,data.id);}
    const {data}=await this.call('/publications/'+segment(id)+'/publish','POST',{idempotency_key:job.id});
    if(data.status!=='published'||String(data.id)!==String(id)||data.idempotency_key!==job.id)throw new RemoteError('The custom connector did not confirm publication.',0,0,true);
    return confirmation(this.site,id,data.url,{status:'published'});
  }
}

export function wixRichContent(html:string){
  const id=()=>crypto.randomUUID();
  const inline=(nodes:any[],decorations:any[]=[]):any[]=>nodes.flatMap(n=>{
    if(n.type==='text')return n.data?[{type:'TEXT',textData:{text:n.data,decorations}}]:[];
    const next=[...decorations];if(['strong','b'].includes(n.name))next.push({type:'BOLD'});if(['em','i'].includes(n.name))next.push({type:'ITALIC'});
    if(n.name==='a'&&n.attribs?.href)next.push({type:'LINK',linkData:{link:{url:n.attribs.href,target:'BLANK'}}});
    if(n.name==='br')return [{type:'TEXT',textData:{text:'\n',decorations}}];
    if(!['strong','b','em','i','a','span'].includes(n.name))throw new RemoteError('This article uses formatting that Wix cannot import safely. Use paragraphs, headings, links, bold/italic and simple tables, or export it for manual publishing.',400);
    return inline(n.children??[],next);
  });
  const block=(n:any):any=>{
    if(n.type==='text')return n.data.trim()?{type:'PARAGRAPH',id:id(),paragraphData:{},nodes:inline([n])}:null;
    if(n.name==='p'||/^h[1-6]$/.test(n.name))return {type:n.name==='p'?'PARAGRAPH':'HEADING',id:id(),...(n.name==='p'?{paragraphData:{}}:{headingData:{level:Number(n.name[1])}}),nodes:inline(n.children??[])};
    if(['thead','tbody'].includes(n.name))return (n.children??[]).map(block).filter(Boolean);
    if(n.name==='table')return {type:'TABLE',id:id(),tableData:{rowHeader:false},nodes:(n.children??[]).flatMap(block).filter(Boolean)};
    if(n.name==='tr')return {type:'TABLE_ROW',id:id(),nodes:(n.children??[]).map(block).filter(Boolean)};
    if(['td','th'].includes(n.name))return {type:'TABLE_CELL',id:id(),nodes:[{type:'PARAGRAPH',id:id(),paragraphData:{},nodes:inline(n.children??[])}]};
    throw new RemoteError('This article contains a block that needs manual Wix formatting. Simplify it or export it for manual publishing; its content will not be silently discarded.',400);
  };
  return {nodes:parseDocument(cleanHTML(html)).children.flatMap(block).filter(Boolean),metadata:{version:1}};
}
export class Wix extends Base {
  private call(path:string,method='GET',body?:any){return this.http(path,method,{Authorization:this.credentials.password,'wix-site-id':this.site.connector_config.site_id},body);}
  async test(){await this.call('/blog/v3/draft-posts/query','POST',{query:{paging:{limit:1}}});return {account:'Wix owner API key',permission_status:'credential_verified',message:'Wix Blog connected. The key must include Manage Blog and the author must belong to this site.'};}
  async publish(job:any,a:any){
    const c=this.site.connector_config;let id=job.remote_post_id;
    if(!id&&(job.remote_attempt_started||job.needs_reconciliation)){
      const {data}=await this.call('/blog/v3/draft-posts/query','POST',{query:{filter:{title:{$eq:a.title}},paging:{limit:100}}});const posts=(data.draftPosts??[]).filter((p:any)=>p.seoSlug===job.remote_slug);
      if(posts.length!==1)throw this.unresolved();id=await this.remember(job,posts[0].id);
    }
    if(!id){await this.mark(job);const {data}=await this.call('/blog/v3/draft-posts','POST',{draftPost:{title:a.title,seoSlug:job.remote_slug,memberId:c.member_id,richContent:wixRichContent(a.content),excerpt:a.meta_description||''},publish:false});id=await this.remember(job,data.draftPost?.id);}
    await this.call('/blog/v3/draft-posts/'+segment(id)+'/publish','POST',{});
    const {data}=await this.call('/blog/v3/posts/query','POST',{query:{filter:{slug:{$eq:job.remote_slug}},paging:{limit:2}},fieldsets:['URL']});const post=(data.posts??[]).find((p:any)=>p.slug===job.remote_slug);
    if(!post?.id||post.slug!==job.remote_slug||!post.url?.base||!post.url?.path)throw new RemoteError('Wix did not confirm a live article URL.',0,0,true);
    return confirmation(this.site,id,new URL(post.url.path,post.url.base).href,{status:'published'});
  }
}
