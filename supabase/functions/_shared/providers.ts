import {db,rpc,text} from './core.ts';
import {requirePermission,auditActor} from './authorization.ts';
const names=['openai','ahrefs','moz','brave'];
export async function providerSecret(tenant:string,name:string){
 const stored=await rpc('read_provider_secret',{p_tenant:tenant,p_provider:name});if(stored?.key)return stored;
 // Environment fallback is explicitly pinned to one tenant, never shared with public signups.
 if(Deno.env.get('INTEGRATION_TENANT_ID')!==tenant)return null;
 const variable:Record<string,string>={openai:'OPENAI_API_KEY',ahrefs:'AHREFS_API_KEY',moz:'MOZ_API_TOKEN',brave:'BRAVE_SEARCH_API_KEY'};const key=Deno.env.get(variable[name]);return key?{key,model:name==='openai'?Deno.env.get('SEO_MODEL')||null:null,license_acknowledged:true}:null;
}
export const providerActions=new Set(['provider.status','provider.configure','provider.revoke']);
export async function providerAction(actor:any,action:string,b:any){
 if(action==='provider.status'){const output=[];for(const provider of names){const s=await providerSecret(actor.tenant_id,provider);output.push({provider,configured:!!s?.key,model:s?.model||null,license_acknowledged:!!s?.license_acknowledged});}return {providers:output};}
 requirePermission(actor,'settings.manage');if(actor.role!=='super_admin')throw new Error('Only the workspace owner may change provider credentials.');const provider=String(b.provider);if(!names.includes(provider))throw new Error('Choose a supported provider.');
 if(action==='provider.revoke'){await rpc('revoke_provider_secret',{p_actor:actor.id,p_provider:provider});await auditActor(actor,'provider_revoked','Stored '+provider+' integration credential removed.');return {message:'Local provider credential removed. Revoke it with the provider as well.'};}
 const key=text(b.key,8000,true),model=provider==='openai'?text(b.model,150,true):null;if(model&&!/^[a-zA-Z0-9_.:-]+$/.test(model))throw new Error('Use the exact model identifier from your provider account.');if(['ahrefs','moz'].includes(provider)&&b.license_acknowledged!==true)throw new Error('Confirm that this workspace is licensed to retrieve and display these provider metrics.');
 await rpc('store_provider_secret',{p_actor:actor.id,p_provider:provider,p_secret:key,p_model:model,p_license:b.license_acknowledged===true});await auditActor(actor,'provider_configured','Tenant-scoped '+provider+' integration configured.');return {message:'Credential saved in the server vault for this workspace only. It is never returned to the browser.'};
}
