import {db,rpc} from '../_shared/core.ts';
import {request} from '../_shared/network.ts';
import {binding} from '../_shared/connectors.ts';
import {testConnection} from '../_shared/connections.ts';

const frontend='https://zeshanayub044-sudo.github.io/guestpostsaas/';
function page(ok:boolean){
  const body=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GuestPost Google connection</title><style>body{font:16px/1.6 system-ui;background:#f3f6fa;color:#0b1220;max-width:600px;margin:12vh auto;padding:30px}a{color:#2563eb}</style><h1>${ok?'Google connection saved':'Google connection needs attention'}</h1><p>${ok?'Your Blogger account is connected. Close this tab and return to GuestPost.':'The request expired, access was declined, or the account cannot publish to this blog. Return to GuestPost and reconnect.'}</p><a href="${frontend}">Return to GuestPost</a>`;
  return new Response(body,{status:ok?200:400,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
}
Deno.serve(async req=>{
  if(req.method!=='GET')return new Response('Method not allowed',{status:405});
  try{
    const u=new URL(req.url),state=u.searchParams.get('state'),code=u.searchParams.get('code');if(!state||state.length>200)throw new Error('Invalid state');
    const intent=await rpc('consume_google_connection',{p_state:state});if(!code||u.searchParams.has('error'))throw new Error('Authorization declined');
    const service=db();const {data:site}=await service.from('websites').select('*').eq('id',intent.website_id).single();if(!site||site.cms_type!=='blogger')throw new Error('Website no longer available');
    const {data:tokens}=await request('https://oauth2.googleapis.com/token','POST',{'Content-Type':'application/x-www-form-urlencoded'},new URLSearchParams({grant_type:'authorization_code',code,client_id:Deno.env.get('GOOGLE_CLIENT_ID')||'',client_secret:Deno.env.get('GOOGLE_CLIENT_SECRET')||'',redirect_uri:Deno.env.get('SUPABASE_URL')+'/functions/v1/oauth-callback',code_verifier:intent.verifier}).toString());
    if(!tokens.access_token||!tokens.refresh_token)throw new Error('Refresh authorization required');
    const {data:blogs}=await request('https://www.googleapis.com/blogger/v3/users/self/blogs?view=AUTHOR','GET',{Authorization:'Bearer '+tokens.access_token});
    const blog=(blogs.items??[]).find((b:any)=>new URL(b.url).hostname===new URL(site.website_url).hostname);
    if(!blog)throw new Error('Blog author access not granted');
    site.connector_config={...site.connector_config,blog_id:String(blog.id)};
    const credentials={access_token:tokens.access_token,refresh_token:tokens.refresh_token,connection_key:binding(site),api_endpoint:site.api_endpoint};
    const verified=await testConnection(site,credentials);
    await rpc('store_credentials',{p_website:site.id,p_credentials:credentials});
    const {error}=await service.from('websites').update({connector_config:site.connector_config,connection_status:'connected',permission_status:verified.permission_status,connection_message:verified.message,tested_at:new Date().toISOString()}).eq('id',site.id);if(error)throw new Error('Connection result not saved');
    await service.from('publishing_logs').insert({tenant_id:site.tenant_id,event_type:'google_connected',message:'Blogger account authorization saved securely.'});return page(true);
  }catch{return page(false);}
});
