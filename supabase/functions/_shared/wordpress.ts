import {request,RemoteError} from './network.ts';
import {rpc,canonicalURL,cleanHTML} from './core.ts';
export class WordPress {
  private headers:Record<string,string>;
  private deadline=Date.now()+85000;
  private request(...args:Parameters<typeof request>){
    const remaining=this.deadline-Date.now();if(remaining<=0)throw new RemoteError('Connector time budget exhausted; retry the job.');
    args[4]=Math.min(25000,remaining);return this.transport(...args);
  }
  constructor(private endpoint:string,credentials:{username:string;password:string},private transport:typeof request=request){
    canonicalURL(endpoint);this.endpoint=endpoint.replace(/\/$/,'');
    this.headers={Authorization:'Basic '+btoa(unescape(encodeURIComponent(credentials.username+':'+credentials.password))),'Content-Type':'application/json'};
  }
  async test(){
    const {data}=await this.request(this.endpoint+'/users/me?context=edit','GET',this.headers);
    if(!data?.capabilities?.publish_posts||!data?.capabilities?.edit_posts)throw new RemoteError('This WordPress account needs permission to create, edit and publish posts.',403);
    return {account:String(data.name??data.slug),id:data.id,permission_status:'verified',message:'WordPress account and publishing permission verified.'};
  }
  async terms(taxonomy:string,names:string[]):Promise<number[]>{
    const ids:number[]=[];
    for(const name of names.filter(Boolean).slice(0,30)){
      const {data}=await this.request(this.endpoint+`/${taxonomy}?search=${encodeURIComponent(name)}&per_page=100`,'GET',this.headers);
      const term=data.find((t:any)=>t.name.toLowerCase()===name.toLowerCase());
      if(!term)throw new RemoteError(`Create the ${taxonomy==='tags'?'tag':'category'} “${name}” on the target website first.`,400);
      ids.push(term.id);
    }
    return ids;
  }
  async publish(job:any,article:any){
    let remoteId=job.remote_post_id;
    // Reconcile every previous attempt; never issue another blind create after an unknown outcome.
    if(!remoteId&&(job.remote_attempt_started||job.needs_reconciliation)){
      const {data}=await this.request(this.endpoint+`/posts?slug=${encodeURIComponent(job.remote_slug)}&status=publish,draft,pending,future,private&context=edit`,'GET',this.headers);
      const post=data.find((p:any)=>p.slug===job.remote_slug);
      if(!post)throw new RemoteError('Unknown prior outcome: no matching remote post found. Verify the WordPress posts/trash before cancelling and creating a new job.',0,0,true);
      remoteId=post.id;
      if(!await rpc('save_remote_id',{p_job:job.id,p_token:job.lease_token,p_remote_id:String(remoteId)}))throw new Error('Worker lease expired.');
      job.remote_post_id=remoteId;
    }
    if(!remoteId){
      let meta:Record<string,string>|undefined;
      const options=await this.request(this.endpoint+'/posts','OPTIONS',this.headers);
      const fields=options.data?.schema?.properties?.meta?.properties??{};
      if(fields.guestpost_meta_title)meta={guestpost_meta_title:article.meta_title||'',guestpost_meta_description:article.meta_description||'',guestpost_focus_keyword:article.focus_keyword||''};
      const categories=await this.terms('categories',article.category?[article.category]:[]);
      const tags=await this.terms('tags',article.tags??[]);
      let featured_media:number|undefined;
      if(article.featured_image){
        // Featured images are uploaded by the browser to tenant-scoped Storage. Never fetch arbitrary third-party image URLs.
        const url=new URL(article.featured_image);const own=new URL(Deno.env.get('SUPABASE_URL')!);
        if(url.origin!==own.origin||!url.pathname.startsWith('/storage/v1/object/public/article-images/'+job.tenant_id+'/'))throw new RemoteError('Featured image must be uploaded to this workspace.',400);
        const image=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});
        const mime=image.headers.get('content-type')??'';
        if(!image.ok||!['image/png','image/jpeg','image/webp'].includes(mime))throw new RemoteError('Featured image unavailable or unsupported.',400);
        const buf=new Uint8Array(await image.arrayBuffer());if(buf.length>5*1024*1024)throw new RemoteError('Image exceeds 5 MB.',400);
        // Image upload can leave an orphan if interrupted; it never creates a duplicate post.
        const upload=await this.request(this.endpoint+'/media','POST',{...this.headers,'Content-Type':mime,'Content-Disposition':`attachment; filename="guestpost-${job.id}.${mime.split('/')[1]}"`},buf);
        featured_media=upload.data.id;
      }
      if(!await rpc('mark_remote_attempt',{p_job:job.id,p_token:job.lease_token}))throw new Error('Worker lease expired.');
      job.remote_attempt_started=true;
      // A draft is created first. The ID is durably saved before the publish operation.
      const {data}=await this.request(this.endpoint+'/posts','POST',this.headers,JSON.stringify({title:article.title,content:cleanHTML(article.content),slug:job.remote_slug,status:'draft',excerpt:article.meta_description,categories,tags,...(meta?{meta}:{}),...(featured_media?{featured_media}:{})}));
      remoteId=data.id;
      if(!Number.isInteger(remoteId))throw new RemoteError('WordPress did not return a post ID.',0,0,true);
      if(!await rpc('save_remote_id',{p_job:job.id,p_token:job.lease_token,p_remote_id:String(remoteId)}))throw new RemoteError('Could not persist remote post ID; reconcile before retrying.',0,0,true);
      job.remote_post_id=remoteId;
    }
    const {data}=await this.request(this.endpoint+'/posts/'+remoteId,'POST',this.headers,JSON.stringify({status:'publish'}));
    const link=canonicalURL(data.link);
    if(link.origin!==new URL(this.endpoint).origin||data.status!=='publish')throw new RemoteError('WordPress did not confirm a published post.',0,0,true);
    return {url:link.href,info:{id:remoteId,status:data.status}};
  }
}
export const connectors={wordpress:WordPress};
