import {browserWorkflow} from '../../supabase/functions/_shared/browser-contract.mjs';

export class WorkflowError extends Error{constructor(code){super(code);this.code=code;}}
const stop=code=>{throw new WorkflowError(code);};
const normalize=s=>String(s||'').replace(/\s+/g,' ').trim();
const challenge='iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"],input[autocomplete="one-time-code"],input[name="otp"],input[name="totp"],[data-captcha],[data-mfa]';
export async function runEditor({context,task,site,credentials,article,kind,checkpoint,signal}){
  const workflow=browserWorkflow(site.cms_type,site.connector_config.browser_workflow?.id==='wordpress-classic-v1'?null:site.connector_config.browser_workflow,site.website_url);
  if(!workflow||workflow.id!==site.connector_config.browser_workflow?.id)stop('layout_changed');
  const origin=new URL(site.website_url).origin,s=workflow.selectors,p=workflow.paths;
  const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(20000);
  const alive=()=>{if(signal?.aborted)stop('lease_expired');};
  const challenges=async()=>{alive();for(const item of await page.locator(challenge).all())if(await item.isVisible())stop('challenge_required');};
  const go=async(path,params={})=>{alive();for(const [key,value]of Object.entries(params))path=path.replaceAll('{'+key+'}',encodeURIComponent(value));const u=new URL(path,origin);if(u.origin!==origin)stop('layout_changed');const response=await page.goto(u.href,{waitUntil:'domcontentloaded'});if(response?.status()>=500)stop('network_error');await challenges();return response;};
  const field=async(selector)=>{alive();const locator=page.locator(selector);if(await locator.count()!==1)stop('layout_changed');return locator;};
  const visible=async(selector)=>await page.locator(selector).isVisible().catch(()=>false);
  const classic=workflow.id==='wordpress-classic-v1';
  const isPublished=async()=>await page.locator(s.published).count()>0;
  const editable=async()=>{await challenges();if(!await visible(s.authenticated))stop('session_expired');if(classic&&await visible('#content-html'))await page.locator('#content-html').click();for(const key of classic?['title','content']:['title','content','slug']){const f=await field(s[key]);if(!await f.isEditable())stop('layout_changed');}if(await page.locator(s.publish).count()!==1)stop(classic&&await page.locator('#publish').count()?'permission_denied':'layout_changed');const publish=await field(s.publish);if(!await publish.isEnabled())stop('permission_denied');};
  const setSlug=async(value)=>{if(classic&&!await visible(s.slug)){if(!await visible('.edit-slug'))stop('layout_changed');await page.locator('.edit-slug').click();await page.locator('#new-post-slug').fill(value);await page.locator('#edit-slug-buttons .save').click();}else await (await field(s.slug)).fill(value);};
  const save=async()=>{alive();await (await field(s.save_draft)).click();await page.waitForLoadState('domcontentloaded');await challenges();};
  const remoteID=async()=>{const id=await (await field(s.remote_id)).inputValue();if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))stop('outcome_unknown');return id;};
  const policyResponse=await go('/.well-known/guestpost-browser.json');let currentManifest;
  try{currentManifest=await policyResponse?.json();}catch{/* Standard WordPress need not install a custom manifest. */}
  if(currentManifest?.protocol==='guestpost.browser.v1'&&currentManifest.automation_permitted===false)stop('automation_restricted');
  if(workflow.id==='custom-editor-v1'||currentManifest?.protocol==='guestpost.browser.v1'){
    const current=browserWorkflow(site.cms_type,currentManifest,site.website_url);
    if(!current||JSON.stringify(current)!==JSON.stringify(workflow))stop('layout_changed');
  }
  await go(p.login);await (await field(s.username)).fill(credentials.username);await (await field(s.password)).fill(credentials.password);
  await challenges();await (await field(s.login_submit)).click();await page.waitForLoadState('domcontentloaded');await challenges();
  if(!await visible(s.authenticated))stop('invalid_credentials');
  if(kind==='check'){
    // Explicit connection consent includes opening an empty editor. WordPress may
    // create an auto-draft here; no title/content is submitted during this check.
    await go(p.editor);await editable();return {success:true};
  }
  if(article.featured_image||article.canonical_url||article.meta_title||article.meta_description||article.category||article.tags?.length||/<img\b/i.test(article.content))stop('unsupported_content');
  const marker='GPJOB-'+task.id,slug=task.remote_slug;
  let id=task.remote_post_id;
  if(!id&&(task.remote_attempt_started||task.needs_reconciliation)){
    await go(p.search,{marker});const matches=page.locator(s.search_result).filter({hasText:marker});if(await matches.count()!==1)stop('outcome_unknown');
    const href=await matches.getAttribute('href');if(!href)stop('outcome_unknown');const link=new URL(href,origin);if(link.origin!==origin)stop('outcome_unknown');
    await go(link.pathname+link.search);id=await remoteID();await checkpoint('remote_id',id);
  }
  if(!id){
    await checkpoint('before_remote');await go(p.editor);await editable();
    await (await field(s.title)).fill(marker+' — '+article.title);await (await field(s.content)).fill(article.content);if(!classic)await setSlug(slug);
    await save();id=await remoteID();await checkpoint('remote_id',id);
  }
  await go(p.edit,{id});
  if(await remoteID()!==String(id))stop('verification_failed');
  if(!await isPublished()){
    await editable();await (await field(s.title)).fill(article.title);await (await field(s.content)).fill(article.content);await setSlug(slug);await save();
    await go(p.edit,{id});await editable();
    if(await remoteID()!==String(id)||normalize(await (await field(s.title)).inputValue())!==normalize(article.title)||normalize(await (await field(s.content)).inputValue())!==normalize(article.content))stop('verification_failed');
    await checkpoint('before_remote');await (await field(s.publish)).click();await page.waitForLoadState('domcontentloaded');await challenges();
    // Re-open the durable record even after a nominal success notice.
    await go(p.edit,{id});
  }
  if(!await visible(s.published)){
    // WordPress stores the original status in a hidden input.
    if(!await page.locator(s.published).count())stop('verification_failed');
  }
  const url=await (await field(s.public_link)).getAttribute('href');if(!url)stop('verification_failed');const publicURL=new URL(url,origin);
  if(publicURL.origin!==origin||publicURL.searchParams.has('preview')||publicURL.pathname.includes('/wp-admin/'))stop('verification_failed');
  alive();const publicContext=await context.browser().newContext({serviceWorkers:'block',acceptDownloads:false});
  try{
    await publicContext.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===origin?route.continue():route.abort();});
    const publicPage=await publicContext.newPage();const response=await publicPage.goto(publicURL.href,{waitUntil:'domcontentloaded',timeout:20000});
    if(!response?.ok()||new URL(publicPage.url()).origin!==origin)stop('verification_failed');
    const verified=await publicPage.evaluate(({title,content})=>{
      const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
      const doc=new DOMParser().parseFromString(content.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi,' </$1>'),'text/html');
      const expected=norm(doc.body.textContent),actual=norm(document.body.innerText);
      const links=[...doc.querySelectorAll('a[href]')].every(a=>[...document.querySelectorAll('a[href]')].some(b=>b.href===a.href&&norm(b.innerText)===norm(a.textContent)));
      return actual.includes(norm(title))&&!!expected&&actual.includes(expected)&&links;
    },{title:article.title,content:article.content});
    if(!verified)stop('verification_failed');
  }finally{await publicContext.close();}
  return {success:true,url:publicURL.href};
}
