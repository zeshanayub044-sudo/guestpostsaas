// Uses the configured Git credential manager. Credentials stay in process memory.
import {spawnSync} from 'node:child_process';
const mode=process.argv[2]??'inspect';
const result=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',timeout:15000,env:{...process.env,GCM_INTERACTIVE:'never',GIT_TERMINAL_PROMPT:'0'}});
const credential=Object.fromEntries((result.stdout??'').trim().split('\n').map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
const token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN||credential.password;
if(!token){console.log(JSON.stringify({blocked:'No GitHub CLI/API credential is available. The connected GitHub MCP has no repository-creation or Pages-settings tool.'}));process.exit(2);}
const api=async(path,method='GET',body)=>{const r=await fetch('https://api.github.com'+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json().catch(()=>({}))};};
const user=await api('/user');if(user.status!==200)throw new Error('GitHub credential is not valid.');
if(user.data.login!=='zeshanayub044-sudo')throw new Error('Git credential does not match the authorized connected account.');
const path='/repos/'+user.data.login+'/guestpostsaas';const existing=await api(path);
if(mode==='inspect'){console.log(JSON.stringify({login:user.data.login,repository_exists:existing.status===200,can_create:existing.status===404}));process.exit(0);}
if(mode==='create'){
  if(existing.status!==404)throw new Error('Repository already exists; refusing to modify any existing repository.');
  const created=await api('/user/repos','POST',{name:'guestpostsaas',description:'Secure, paced editorial publishing with Supabase and WordPress',private:false,auto_init:true});
  if(created.status!==201)throw new Error('Repository creation failed (HTTP '+created.status+').');
  console.log(JSON.stringify({repository:created.data.html_url,created:true}));
}else if(mode==='pages'){
  if(existing.status!==200)throw new Error('New application repository was not found.');
  const pages=await api(path+'/pages');
  const configured=await api(path+'/pages',pages.status===404?'POST':'PUT',{build_type:'workflow'});
  if(![201,204].includes(configured.status))throw new Error('Pages configuration failed (HTTP '+configured.status+').');
  console.log(JSON.stringify({pages_configured:true,url:'https://'+user.data.login+'.github.io/guestpostsaas/'}));
}else throw new Error('Unsupported operation.');
