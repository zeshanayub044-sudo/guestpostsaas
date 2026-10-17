// Optional integration harness. Never logs the generated password or access token.
// Start in a retained terminal; provision only the emitted disposable QA fixture
// in the NEW project, then send "ready" on stdin. Cleanup its tenant afterwards.
import {randomBytes,randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import bcrypt from 'bcryptjs';
const base='https://aiolueflrpraiaqvdscp.supabase.co';
const key='sb_publishable_vH-ntWE5Lo8gzVETDIRTVg_Xq6jWW7G';
const id=randomUUID(),email='qa-http-'+id+'@example.com',password=randomBytes(32).toString('base64url');
const hash=await bcrypt.hash(password,10);
const input=createInterface({input:process.stdin,output:process.stdout});
console.log(JSON.stringify({stage:'awaiting_disposable_auth_fixture',id,email,password_hash:hash}));
await new Promise(resolve=>input.once('line',resolve));
while(true){
const results=[];
const check=(name,value)=>{results.push({test:name,passed:!!value});};
const http=async(path,options={})=>{const r=await fetch(base+path,{...options,signal:AbortSignal.timeout(35000),headers:{apikey:key,'Content-Type':'application/json',...options.headers}});return{status:r.status,data:await r.json().catch(()=>({}))};};
let token;
try{
  check('API denies unauthenticated calls',(await http('/functions/v1/api',{method:'POST',body:JSON.stringify({action:'settings.save'})})).status===401);
  check('Worker rejects missing scheduler token',(await http('/functions/v1/publish-worker',{method:'POST',body:'{}'})).status===401);
  check('CORS preflight succeeds',(await http('/functions/v1/api',{method:'OPTIONS',headers:{origin:'https://zeshanayub044-sudo.github.io'}})).status===204);
  const login=await http('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});
  token=login.data.access_token;check('Supabase password login succeeds',login.status===200&&!!token);
  if(!token)throw new Error('Disposable login failed: '+login.status);
  const api=async(action,data={})=>http('/functions/v1/api',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({action,data})});
  check('Authenticated user endpoint succeeds',(await http('/auth/v1/user',{headers:{Authorization:'Bearer '+token}})).data.id===id);
  const profile=await http('/rest/v1/profiles?select=*',{headers:{Authorization:'Bearer '+token}});check('Owner can read only its own workspace profile',profile.status===200&&profile.data.length===1&&profile.data[0].id===id);
  const transport=await api('system.health');check('Deployed HTTPS transport reads public WordPress API',transport.status===200&&transport.data.wordpress_https_transport==='reachable');
  if(transport.status!==200)console.log(JSON.stringify({transport_diagnostic:transport.data.error}));
  check('Unsafe website URL rejected',(await api('website.save',{website_name:'Unsafe',website_url:'https://127.0.0.1',authorized:true})).status===400);
  const website=await api('website.save',{website_name:'QA disposable connection',website_url:'https://zeshanayub044-sudo.github.io/guestpostsaas/qa-'+id,cms_type:'manual',authorized:true});
  check('Manual website metadata is saved without a publishing credential',website.status===200&&!!website.data.id&&website.data.status==='manual');
  const article=await api('article.save',{title:'Disposable integration article',content:'<h2>Safe content</h2><script>alert(1)</script><a href="javascript:alert(1)">link</a>',status:'approved'});
  check('Article creation succeeds',article.status===200&&!!article.data.id);
  const articles=await http('/rest/v1/articles?select=*',{headers:{Authorization:'Bearer '+token}});const saved=articles.data.find(a=>a.id===article.data.id);
  check('Server sanitizes content and prevents approval on save',saved?.status==='draft'&&!/script|javascript/.test(saved.content));
  const shortage=await api('campaign.preview',{article_id:article.data.id,quantity:100,interval:300,mode:'auto'});
  check('Article still requires approval before campaign preview',shortage.status===400);
  check('Owner editorial approval succeeds',(await api('article.approve',{id:article.data.id})).status===200);
  const preview=await api('campaign.preview',{article_id:article.data.id,quantity:100,interval:300,mode:'auto'});
  check('100-target preview reports a real shortage',preview.status===200&&preview.data.shortage===100&&preview.data.targets.length===0);
  check('Unvalidated website cannot be queued',(await api('campaign.create',{article_id:article.data.id,campaign_name:'Must reject',website_ids:[website.data.id],interval:300,quantity:1,mode:'manual',authorized:true,editorial_approved:true})).status===400);
  check('Browser cannot execute worker claim RPC',(await http('/rest/v1/rpc/claim_next_job',{method:'POST',headers:{Authorization:'Bearer '+token},body:'{}'})).status>=400);
  check('Browser cannot read credential RPC',(await http('/rest/v1/rpc/read_credentials',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({p_website:website.data.id})})).status>=400);
  check('Browser cannot change its own role',(await http('/rest/v1/profiles?id=eq.'+id,{method:'PATCH',headers:{Authorization:'Bearer '+token},body:JSON.stringify({role:'admin'})})).status>=400);
  check('Credential revocation succeeds',(await api('website.revoke',{id:website.data.id})).status===200);
  check('Unused website deletion succeeds',(await api('website.delete',{id:website.data.id})).status===200);
  check('Unused article deletion succeeds',(await api('article.delete',{id:article.data.id})).status===200);
  check('Logout succeeds',(await http('/auth/v1/logout',{method:'POST',headers:{Authorization:'Bearer '+token}})).status===204);
}catch(e){console.log(JSON.stringify({harness_error:e.message}));check('Integration harness completed',false);}
finally{console.log(JSON.stringify({fixture_id:id,results,passed:results.filter(r=>r.passed).length,total:results.length}));}
if(process.argv.includes('--hold')){console.log(JSON.stringify({stage:'awaiting_retest_or_finish'}));const answer=await new Promise(resolve=>input.once('line',resolve));if(String(answer).trim()==='again')continue;}
if(results.some(r=>!r.passed))process.exitCode=1;
break;
}
input.close();
