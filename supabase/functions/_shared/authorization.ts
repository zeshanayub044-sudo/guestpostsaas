import {db,rpc,uuid} from './core.ts';
export function can(actor:any,key:string){return actor.role==='super_admin'||Array.isArray(actor.permissions)&&actor.permissions.includes(key);}
export function requirePermission(actor:any,key:string){if(!can(actor,key))throw new Error('Permission required: '+key);}
export const actionPermissions:Record<string,string>={
 'website.discover':'websites.connect','website.discover.saved':'websites.connect','website.connect':'websites.connect','website.save':'websites.update','website.test':'websites.connect','website.options':'websites.connect','website.verify_permissions':'websites.connect','website.import':'websites.create','import.retry':'websites.create','website.toggle':'websites.update','website.delete':'websites.update','website.revoke':'websites.connect','article.save':'articles.create','article.approve':'articles.approve','article.delete':'articles.edit','campaign.preview':'campaigns.create','campaign.start':'campaigns.launch','campaign.create':'campaigns.launch','campaign.control':'campaigns.cancel','job.retry':'campaigns.launch','settings.save':'settings.manage','worker.register':'settings.manage','worker.status':'settings.manage','worker.revoke':'settings.manage','quality.save':'settings.manage','metrics.record':'publishers.research','oauth.google.begin':'websites.connect','system.health':'settings.manage','user.invite':'users.create','user.update':'users.update'
};
export async function authorizeAction(actor:any,action:string,b:any){
 const permission=action==='article.save'&&b.id?'articles.edit':actionPermissions[action];if(permission)requirePermission(actor,permission);
 if((action.startsWith('website.')||action.startsWith('oauth.'))&&(b.id||b.website_id)&&!await rpc('website_access',{p_actor:actor.id,p_website:uuid(b.id||b.website_id),p_scope:'connect'}))throw new Error('This website connection is not assigned to your account.');
 if(action==='article.save'&&b.id)requirePermission(actor,'articles.edit');
 if((action.startsWith('article.')&&b.id)||action.startsWith('seo.')&&b.article_id){
  const {data:a}=await db().from('articles').select('id,owner_id,assigned_to,status').eq('id',uuid(b.id||b.article_id)).eq('tenant_id',actor.tenant_id).single();
  if(!a||!can(actor,'articles.read_all')&&a.owner_id!==actor.id&&a.assigned_to!==actor.id)throw new Error('This article is not assigned to your account.');
 }
 if(['campaign.preview','campaign.start','campaign.create'].includes(action)&&b.article_id){
  const {data:a}=await db().from('articles').select('status,owner_id,assigned_to').eq('id',uuid(b.article_id)).eq('tenant_id',actor.tenant_id).single();if(!a)throw new Error('Article not found in this workspace.');
  if(!can(actor,'articles.read_all')&&a.owner_id!==actor.id&&a.assigned_to!==actor.id)throw new Error('Choose an article assigned to your account.');
  if(action!=='campaign.preview'&&a.status!=='approved'){requirePermission(actor,'articles.approve');requirePermission(actor,'campaigns.approve');}
 }
 if(action==='campaign.control')await ownCampaign(actor,b.id);
 if(action==='job.retry'){const {data:j}=await db().from('publishing_jobs').select('campaign_id').eq('id',uuid(b.id)).eq('tenant_id',actor.tenant_id).single();if(!j)throw new Error('Publishing job not found.');await ownCampaign(actor,j.campaign_id);}
}
export async function ownCampaign(actor:any,id:unknown){
 requirePermission(actor,'campaigns.view');
 const {data,error}=await db().from('campaigns').select('*').eq('id',uuid(id)).eq('tenant_id',actor.tenant_id).single();if(error||!data||!can(actor,'campaigns.read_all')&&data.owner_id!==actor.id&&data.assigned_to!==actor.id)throw new Error('Campaign not found or not assigned to your account.');return data;
}
export async function auditActor(actor:any,action:string,message:string){const {error}=await db().from('publishing_logs').insert({tenant_id:actor.tenant_id,actor_id:actor.id,event_type:action,message:String(message).slice(0,1000)});if(error)throw new Error('The activity log could not be saved.');}
export async function permissionsFor(actor:any){return rpc('effective_permissions',{p_actor:actor.id});}
