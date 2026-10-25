import {db,rpc,text,uuid} from './core.ts';
import {can,requirePermission,auditActor} from './authorization.ts';
const roles=['admin','seo_manager','editor','publishing_operator','viewer'];
export const teamActions=new Set(['team.create','team.update','team.reset','team.permissions','team.activity','account.context','account.change_password']);
export async function teamAction(actor:any,action:string,b:any){
 const service=db();
 if(action==='account.context')return {profile:actor,permissions:actor.permissions||[],password_change_required:actor.password_change_required};
 if(action==='account.change_password'){
  if(!actor.password_change_required)throw new Error('Use the normal account recovery flow for an optional password reset.');
  const password=text(b.password,200,true);if(password.length<12)throw new Error('Use a new password with at least 12 characters.');
  const {error}=await service.auth.admin.updateUserById(actor.id,{password});if(error)throw new Error('The new password was rejected. Use a stronger password and retry.');
  await rpc('complete_employee_password_change',{p_actor:actor.id});await auditActor(actor,'employee_password_changed','Required credential change completed. Fresh sign-in required.');return {requires_sign_in:true};
 }
 if(action==='team.permissions'){requirePermission(actor,'users.read');const [p,r,u]=await Promise.all([service.from('permissions').select('*'),service.from('role_permissions').select('*'),service.from('user_permissions').select('*').eq('tenant_id',actor.tenant_id)]);if(p.error||r.error||u.error)throw new Error('Permissions could not be loaded.');return {permissions:p.data,role_permissions:r.data,user_permissions:u.data};}
 if(action==='team.activity'){
  requirePermission(actor,'users.read');let q=service.from('publishing_logs').select('id,actor_id,event_type,message,created_at').eq('tenant_id',actor.tenant_id).order('created_at',{ascending:false}).limit(250);if(b.actor_id)q=q.eq('actor_id',uuid(b.actor_id));if(b.event_type)q=q.eq('event_type',text(b.event_type,100));if(b.since)q=q.gte('created_at',new Date(b.since).toISOString());const {data,error}=await q;if(error)throw new Error('Activity could not be loaded.');return {events:data};
 }
 if(action==='team.create'){
  requirePermission(actor,'users.create');const email=text(b.email,254,true).toLowerCase(),role=String(b.role||'editor');if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!roles.includes(role))throw new Error('Choose a valid employee email and role.');if(role==='admin'&&actor.role!=='super_admin')throw new Error('Only the workspace owner may appoint an administrator.');
  const full_name=text(b.full_name,200,true),department=text(b.department,100),temporary=b.authentication==='temporary';let password='';if(temporary){password=text(b.temporary_password,200,true);if(password.length<12)throw new Error('Temporary passwords need at least 12 characters.');}
  const {data:existing,error:lookupError}=await service.from('profiles').select('id').eq('email',email).maybeSingle();if(lookupError||existing)throw new Error('This email already belongs to an account, or its availability could not be checked.');
  const {error:pending}=await service.from('tenant_invites').insert({tenant_id:actor.tenant_id,email,role,can_publish:['admin','seo_manager','publishing_operator'].includes(role),full_name,department,password_change_required:true,active:b.active!==false});if(pending)throw new Error('An enrollment already exists for this email. Resolve that invitation before retrying.');
  const created=temporary?await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name}}):await service.auth.admin.inviteUserByEmail(email,{redirectTo:'https://zeshanayub044-sudo.github.io/guestpostsaas/',data:{full_name}});
  if(created.error||!created.data.user){await service.from('tenant_invites').delete().eq('tenant_id',actor.tenant_id).eq('email',email);throw new Error(temporary?'Auth could not create the employee. Confirm the email and password requirements.':'Invitation delivery failed. Check Supabase Auth email settings; no employee access was granted.');}
  const {data:profile}=await service.from('profiles').select('*').eq('id',created.data.user.id).single();if(!profile||profile.tenant_id!==actor.tenant_id||profile.role!==role){await service.auth.admin.updateUserById(created.data.user.id,{ban_duration:'876000h'});throw new Error('Employee enrollment did not match this workspace. The new account was blocked for investigation.');}
  await auditActor(actor,'employee_created','Created '+role+' employee account using '+(temporary?'a required-change temporary credential.':'a secure invitation.'));return {id:profile.id,message:temporary?'Employee created. They must change the temporary password before accessing workspace data.':'Invitation sent. The employee must establish a private password before accessing workspace data.'};
 }
 const {data:target}=await service.from('profiles').select('*').eq('id',uuid(b.id)).eq('tenant_id',actor.tenant_id).single();if(!target)throw new Error('Employee not found in this workspace.');if(target.id===actor.id||target.role==='super_admin')throw new Error('Your own access and protected owner accounts cannot be changed here.');
 if(action==='team.reset'){
  requirePermission(actor,'users.update');if(target.role==='admin'&&actor.role!=='super_admin')throw new Error('Only the owner may reset administrator access.');
  const {error}=await service.auth.resetPasswordForEmail(target.email,{redirectTo:'https://zeshanayub044-sudo.github.io/guestpostsaas/'});if(error)throw new Error('Reset email could not be delivered. Check Auth email configuration.');await auditActor(actor,'employee_reset_requested','Secure recovery email requested for an employee.');return {message:'Secure password reset requested.'};
 }
 if(action==='team.update'){
  requirePermission(actor,'users.update');if('active' in b)requirePermission(actor,'users.disable');const role=String(b.role||target.role);if(!roles.includes(role))throw new Error('Choose an employee role.');if((target.role==='admin'||role==='admin')&&actor.role!=='super_admin')throw new Error('Only the owner may change administrator access.');
  const overrides=b.permissions;if(overrides){if(typeof overrides!=='object'||Array.isArray(overrides))throw new Error('Permissions must be a key/value map.');for(const [key,value]of Object.entries(overrides)){if(typeof value!=='boolean'||!can(actor,key)||actor.role!=='super_admin'&&key.startsWith('users.'))throw new Error('You cannot grant or override this permission: '+key);}}
  await rpc('update_employee_access',{p_actor:actor.id,p_employee:target.id,p_role:role,p_active:b.active!==false,p_name:text(b.full_name??target.full_name,200,true),p_department:text(b.department??target.department,100),p_permissions:overrides||null});
  const banned=await service.auth.admin.updateUserById(target.id,{ban_duration:b.active===false?'876000h':'none'});await auditActor(actor,'employee_access_updated','Employee role, assignment permissions or account status updated. Existing sessions were fenced.');return {message:banned.error?'Application access updated and old sessions blocked. Auth ban state needs administrator review.':'Employee access updated. A fresh sign-in is required.'};
 }
 throw new Error('Unknown employee action.');
}
