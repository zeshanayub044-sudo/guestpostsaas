// Real Chromium + a disposable editorial fixture. These are not CMS certification tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {chromium} from 'playwright';
import {runEditor} from '../src/editor.mjs';

const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
async function fixture(){
  const posts=new Map();let serial=0,publishes=0,mode='normal';
  const server=http.createServer(async(req,res)=>{
    const u=new URL(req.url,'http://fixture');let body='';for await(const chunk of req)body+=chunk;const data=Object.fromEntries(new URLSearchParams(body));
    const redirect=path=>{res.writeHead(303,{Location:path});res.end();};const html=value=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body>'+value+'</body></html>');};
    if(u.pathname==='/.well-known/guestpost-browser.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(mode==='policy'?{...recipe,automation_permitted:false}:recipe));}
    if(u.pathname==='/login'&&req.method==='GET')return html(mode==='challenge'?'<input autocomplete="one-time-code" data-mfa>':'<form action="/login" method="POST"><input name="username" id="username"><input name="password" id="password" type="password"><button id="login">Sign in</button></form>');
    if(u.pathname==='/login'&&req.method==='POST'){if(data.password!=='fixture-only')return redirect('/login');res.setHeader('Set-Cookie','sid=fixture; HttpOnly; SameSite=Strict');return redirect('/admin');}
    if(u.pathname.startsWith('/public/')){const post=posts.get(u.pathname.split('/').at(-1));if(!post||post.status!=='published'){res.writeHead(404);return res.end();}return html(mode==='wrong-public'?'<h1>Wrong resource</h1>':`<h1>${esc(post.title)}</h1>${post.content}`);}
    if(!String(req.headers.cookie).includes('sid=fixture'))return redirect('/login');
    if(u.pathname==='/admin')return html('<nav id="authenticated">Editorial workspace</nav>');
    if(u.pathname==='/search')return html('<div id="authenticated"></div>'+[...posts.values()].filter(p=>p.title.includes(u.searchParams.get('marker'))).map(p=>`<a class="result" href="/edit/${p.id}">${esc(p.title)}</a>`).join(''));
    if(u.pathname==='/editor'||u.pathname.startsWith('/edit/')){
      if(mode==='expired')return redirect('/login');const post=posts.get(u.pathname.split('/').at(-1))||{id:'',title:'',content:'',slug:''};
      return html(`<nav id="authenticated">Editorial workspace</nav><form method="POST"><input id="remote" name="id" type="hidden" value="${esc(post.id)}">${mode==='layout'?'':`<input id="title" name="title" value="${esc(post.title)}">`}<textarea id="content" name="content">${esc(post.content)}</textarea><input id="slug" name="slug" value="${esc(post.slug)}"><button id="save" formaction="/save">Save draft</button><button id="publish" ${mode==='permission'?'disabled':''} formaction="/publish">Publish</button></form>${post.status==='published'?`<div id="published">Published</div><a id="public" href="/public/${post.id}">View post</a>`:''}`);
    }
    if(u.pathname==='/save'){
      const existing=[...posts.values()].find(p=>p.slug===data.slug);const id=data.id||existing?.id||String(++serial);posts.set(id,{...data,id,status:posts.get(id)?.status||'draft'});if(mode==='lost-create'){req.socket.destroy();return;}return redirect('/edit/'+id);
    }
    if(u.pathname==='/publish'){
      const post=posts.get(data.id);if(!post){res.writeHead(400);return res.end();}if(post.status!=='published')publishes++;post.status='published';if(mode==='lost-publish'){req.socket.destroy();return;}return redirect('/edit/'+post.id);
    }
    res.writeHead(404);res.end();
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const recipe={id:'custom-editor-v1',protocol:'guestpost.browser.v1',automation_permitted:true,idempotency:'unique_slug',paths:{login:'/login',editor:'/editor',search:'/search?marker={marker}',edit:'/edit/{id}'},selectors:{username:'#username',password:'#password',login_submit:'#login',authenticated:'#authenticated',title:'#title',content:'#content',slug:'#slug',save_draft:'#save',remote_id:'#remote',publish:'#publish',published:'#published',public_link:'#public',search_result:'.result'}};
  return {origin,posts,recipe,setMode:value=>{mode=value;},get publishes(){return publishes;},close:()=>new Promise(r=>server.close(r))};
}
test('browser editor workflow, public verification and failure recovery',async t=>{
  const siteFixture=await fixture();const browser=await chromium.launch({headless:true});
  const site={cms_type:'custom',website_url:siteFixture.origin,connector_config:{browser_workflow:siteFixture.recipe}};
  const article={title:'Fixture publication',content:'<p>Verified body with <a href="https://publisher.org/reference">reference link</a>.</p>',tags:[]};
  const credentials={username:'fixture-editor',password:'fixture-only'};
  let seq=0;const job=()=>({id:'11111111-1111-4111-8111-'+String(++seq).padStart(12,'0'),remote_slug:'fixture-'+seq,remote_post_id:null,remote_attempt_started:false});
  const execute=async(task,options={})=>{const context=await browser.newContext();try{return await runEditor({context,site,article,credentials,kind:'job',task,checkpoint:async(phase,id)=>{if(phase==='before_remote')task.remote_attempt_started=true;if(id){if(options.loseCheckpoint){options.loseCheckpoint=false;throw new Error('Simulated lost ID callback');}task.remote_post_id=id;}},...options});}finally{await context.close();}};
  try{
    await t.test('connect checks publishing fields without submitting content',async()=>{const context=await browser.newContext();try{assert.equal((await runEditor({context,site,credentials,kind:'check',task:{}})).success,true);assert.equal(siteFixture.posts.size,0);}finally{await context.close();}});
    await t.test('publishes once and verifies content and backlink without login cookies',async()=>{const task=job();const result=await execute(task);assert.match(result.url,/\/public\/1$/);assert.equal(siteFixture.posts.size,1);assert.equal(siteFixture.publishes,1);await execute(task);assert.equal(siteFixture.publishes,1);});
    await t.test('lost draft checkpoint reconciles the marker without creating another post',async()=>{const task=job();await assert.rejects(execute(task,{loseCheckpoint:true}));const count=siteFixture.posts.size;assert.equal(task.remote_post_id,null);await execute(task);assert.equal(siteFixture.posts.size,count);});
    await t.test('a dropped create response and browser POST retries retain one draft',async()=>{const task=job(),before=siteFixture.posts.size;siteFixture.setMode('lost-create');try{await execute(task);}catch{/* The request outcome is deliberately uncertain. */}assert.equal(siteFixture.posts.size,before+1);siteFixture.setMode('normal');assert.equal((await execute(task)).success,true);assert.equal(siteFixture.posts.size,before+1);});
    await t.test('lost publish response reconciles the durable remote ID',async()=>{const task=job(),before=siteFixture.publishes;siteFixture.setMode('lost-publish');try{await execute(task);}catch{/* Browser navigation may report the disconnect, or reconcile it immediately. */}assert.ok(task.remote_post_id);assert.equal(siteFixture.publishes,before+1);const count=siteFixture.posts.size,published=siteFixture.publishes;siteFixture.setMode('normal');assert.equal((await execute(task)).success,true);assert.equal(siteFixture.posts.size,count);assert.equal(siteFixture.publishes,published);});
    await t.test('unconfirmed public content is never successful',async()=>{siteFixture.setMode('wrong-public');await assert.rejects(execute(job()),e=>e.code==='verification_failed');siteFixture.setMode('normal');});
    for(const [mode,code]of [['policy','automation_restricted'],['challenge','challenge_required'],['permission','permission_denied'],['layout','layout_changed'],['expired','session_expired']])await t.test(mode+' stops safely',async()=>{siteFixture.setMode(mode);const before=siteFixture.publishes;await assert.rejects(execute(job()),e=>e.code===code);assert.equal(siteFixture.publishes,before);siteFixture.setMode('normal');});
    await t.test('invalid credentials are classified without exposing a password',async()=>{await assert.rejects(execute(job(),{credentials:{username:'fixture',password:'wrong'}}),e=>e.code==='invalid_credentials');});
    await t.test('unknown remote outcome never blindly creates another draft',async()=>{const task=job();task.remote_attempt_started=true;const before=siteFixture.posts.size;await assert.rejects(execute(task),e=>e.code==='outcome_unknown');assert.equal(siteFixture.posts.size,before);});
  }finally{await browser.close();await siteFixture.close();}
});
