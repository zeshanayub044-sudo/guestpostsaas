// Isolated UI acceptance fixtures. All backend traffic is intercepted; no real account is used.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from '../browser-worker/node_modules/playwright/index.mjs';
import {utils,write} from 'xlsx';
const root=resolve('dist'),server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!path.startsWith(root))throw new Error();const file=path===root||path===root+'\\'?root+'/index.html':path;const data=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(data);}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const uid='10000000-0000-4000-8000-000000000001',tenant='10000000-0000-4000-8000-000000000002',now=new Date().toISOString();
const profile={id:uid,tenant_id:tenant,role:'super_admin',email:'isolated-ui@fixture.invalid',full_name:'Isolated UI fixture',active:true,password_change_required:false};
const user={id:uid,email:profile.email,aud:'authenticated',role:'authenticated',created_at:now,app_metadata:{provider:'email'},user_metadata:{full_name:profile.full_name}};
const token=[{alg:'HS256',typ:'JWT'},{sub:uid,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),session_id:'10000000-0000-4000-8000-000000000003'}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.Zml4dHVyZQ';
const sites=[1,2,3].map(n=>({id:'20000000-0000-4000-8000-'+String(n).padStart(12,'0'),tenant_id:tenant,owner_id:uid,website_name:'Isolated website '+n,website_url:'https://isolated-fixture-'+n+'.publisher.org',cms_type:'custom',status:'active',connection_status:'connected',permission_status:'verified',connection_method:'api',created_at:now,category:'Finance',language:'en'}));
const qualification={auto_ready:false,group:'pending_verification',quality_status:'pending_seo_verification',publishing_status:'connector_configuration_required',reason:'Original owner workbook and licensed Moz evidence are required.',spreadsheet_source:false,domain_authority:null,spam_score:null,organic_traffic:null,reachability_status:'verification_pending',editorial_review:'pending'};
const requests=[],errors=[];
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});
await page.routeWebSocket('wss://aiolueflrpraiaqvdscp.supabase.co/**',ws=>ws.close());
page.on('pageerror',e=>errors.push(e.message));
await page.route('https://aiolueflrpraiaqvdscp.supabase.co/**',async route=>{const request=route.request(),url=new URL(request.url());let body;
 if(url.pathname.startsWith('/auth/v1/token'))body={access_token:token,refresh_token:'isolated-fixture-refresh',expires_in:3600,token_type:'bearer',user};
 else if(url.pathname==='/auth/v1/user')body=user;
 else if(url.pathname==='/functions/v1/api'){const input=request.postDataJSON();requests.push(input);const b=input.data||{};switch(input.action){
 case 'account.context':body={profile,permissions:[],password_change_required:false};break;
 case 'inventory.list':body={items:sites.map(w=>({id:w.id,qualification,can_publish:true,can_connect:true})),policy:{minimum_da:30,maximum_spam:5},next_offset:null};break;
 case 'inventory.detail':body={site:sites.find(w=>w.id===b.id),qualification,sources:[],checks:[],assignments:[],metrics:[]};break;
 case 'provider.status':body={providers:['openai','moz','ahrefs'].map(provider=>({provider,configured:false}))};break;
 case 'article.prepare':body={id:'30000000-0000-4000-8000-000000000001',message:'Original source saved as an unapproved draft.'};break;
 case 'task.assignees':body={people:[profile]};break;
 case 'workbook.list':body={workbooks:[]};break;
 default:body={reports:[],tasks:[],publishers:[],filters:{},workers:[],integrations:[],integration:null,connectors:[]};
 }}else if(url.pathname.startsWith('/rest/v1/')){const table=url.pathname.split('/').pop();const rows=table==='websites'?sites:table==='profiles'?[profile]:table==='settings'?[{tenant_id:tenant,quality_filters:{},publisher_filters:{},qualification_policy:{}}]:[];body=request.headers().accept?.includes('object')?rows[0]:rows;
 }else {body={};}
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
});
try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('input[name=email]').fill(profile.email);await page.locator('input[name=password]').fill('IsolatedFixtureOnly123!');await page.locator('#auth-form button[type=submit],#auth-form button').last().click();await page.locator('#sidebar').waitFor({timeout:30000});
 const go=async hash=>{await page.evaluate(h=>{location.hash=h;},hash);await page.waitForTimeout(100);};
 await go('publishing');assert.equal(await page.locator('[data-v4-target]').count(),0);assert.match(await page.locator('body').innerText(),/mandatory workbook source/);
 await go('discovery');assert.equal(await page.getByRole('button',{name:'Ready network (0)',exact:true}).count(),1);assert.match(await page.locator('body').innerText(),/Unknown/);await page.getByRole('button',{name:'Evidence & access'}).first().click();await page.getByRole('heading',{name:'Website evidence and assigned access'}).waitFor();assert.match(await page.locator('#modal').innerText(),/No original workbook row/);await page.locator('#modal').evaluate(el=>el.close());
 await go('imports');const book=utils.book_new();for(const [name,count] of [['First list',600],['Second list',450]])utils.book_append_sheet(book,utils.aoa_to_sheet([['URL','DA'],...Array.from({length:count},(_,n)=>['isolated-'+n+'.publisher.org','90'])]),name);await page.locator('#v6-workbook').setInputFiles({name:'isolated-acceptance.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(write(book,{type:'buffer',bookType:'xlsx'}))});await page.getByRole('button',{name:'Preview full workbook'}).click();await page.getByText(/1050 rows · 2 sheets/).waitFor();await mkdir('.local',{recursive:true});await page.screenshot({path:'.local/v6-ui-import.png',fullPage:true});
 await go('settings');assert.equal(await page.locator('#v6-policy input[name=minimum_da]').getAttribute('min'),'30');assert.equal(await page.locator('#v6-policy input[name=maximum_spam]').getAttribute('max'),'5');assert.equal(await page.locator('#publisher-filters').count(),0);
 await go('articles');const original='This is the exact isolated source paragraph.\n\nA second paragraph remains unchanged.';await page.locator('#v6-paragraph textarea').fill(original);await page.locator('#v6-paragraph input[name=target_url]').fill('https://client-fixture.publisher.org/retirement');await page.getByRole('button',{name:'Save original draft'}).click();await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('unapproved draft'));const saved=requests.find(r=>r.action==='article.prepare');assert.equal(saved.data.content,original);assert.equal(saved.data.target_url,'https://client-fixture.publisher.org/retirement');assert.equal(requests.some(r=>['campaign.start','campaign.create','smoke.launch'].includes(r.action)),false);assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:6,fixture_only:true,external_requests:0,screenshot:'.local/v6-ui-import.png'}));
}finally{await browser.close();server.close();}
