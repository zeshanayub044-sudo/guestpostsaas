// Declarative browser adapters only. No downloaded JavaScript or arbitrary actions.
export const browserAdapters=['wordpress-classic-v1','custom-editor-v1'];
export function browserWorkflow(platform, manifest, base) {
  const origin=new URL(base).origin;
  if(platform==='wordpress'&&!manifest) {
    const prefix=new URL(base).pathname.replace(/\/$/,'');
    return {id:'wordpress-classic-v1',protocol:'guestpost.browser.v1',automation_permitted:true,
      paths:{login:prefix+'/wp-login.php',editor:prefix+'/wp-admin/post-new.php?classic-editor',search:prefix+'/wp-admin/edit.php?s={marker}&post_status=all',edit:prefix+'/wp-admin/post.php?post={id}&action=edit'},
      selectors:{username:'#user_login',password:'#user_pass',login_submit:'#wp-submit',authenticated:'#wpadminbar',title:'#title',content:'#content',slug:'#post_name',save_draft:'#save-post',remote_id:'#post_ID',publish:'#publish[value="Publish"]',published:'#original_post_status[value="publish"]',public_link:'#sample-permalink a[href]',search_result:'a.row-title'},
      capabilities:{html:true,featured_image:false,seo:false,taxonomies:false,canonical:false}};
  }
  if(!manifest||manifest.protocol!=='guestpost.browser.v1'||manifest.id!=='custom-editor-v1'||manifest.automation_permitted!==true) return null;
  const paths={},selectors={};
  for(const key of ['login','editor','search','edit']) {
    const p=manifest.paths?.[key];
    if(typeof p!=='string'||p.length>1200||!p.startsWith('/')||p.startsWith('//')||p.includes('\\'))throw new Error('Browser connector paths must be relative to this website.');
    const u=new URL(p,origin);if(u.origin!==origin||u.username||u.password||u.hash)throw new Error('Browser connector navigation must stay on this website.');paths[key]=p;
  }
  if(!paths.search.includes('{marker}')||!paths.edit.includes('{id}'))throw new Error('Browser connector needs deterministic draft search and edit paths.');
  for(const key of ['username','password','login_submit','authenticated','title','content','slug','save_draft','remote_id','publish','published','public_link','search_result']) {
    const s=manifest.selectors?.[key];
    if(typeof s!=='string'||!s||s.length>300||/[\r\n]/.test(s)||s.includes('>>'))throw new Error('Browser connector selectors are missing or invalid.');selectors[key]=s;
  }
  return {id:'custom-editor-v1',protocol:manifest.protocol,automation_permitted:true,paths,selectors,capabilities:{html:true,featured_image:false,seo:false,taxonomies:false,canonical:false}};
}
export function connectionLabel(site) {
  if(site.connection_status==='connected')return site.connection_method==='browser'?'Browser Connected':'API Connected';
  return ({authorization_required:'Authorization Required',setup_required:'Connector Setup Required',checking:'Authorization Required',error:'Connection Failed',limited:'Connection Failed',revoked:'Authorization Required',untested:'Connector Setup Required',manual:'Connector Setup Required',unsupported:'Unsupported'})[site.connection_status]||'Connector Setup Required';
}
export function failure(code) {
  const messages={invalid_credentials:'The publishing login was rejected. Reconnect the authorized account.',challenge_required:'The website requires CAPTCHA, MFA or another account check. Complete it through the normal website; automation has stopped.',permission_denied:'This account does not have an enabled publishing action.',layout_changed:'The editor does not match the configured browser workflow. Update and verify the connector.',session_expired:'The publishing session expired. Reconnect the authorized account.',network_error:'The destination could not be reached securely. Check its availability.',verification_failed:'The public page could not be verified. Inspect the existing remote post before retrying.',outcome_unknown:'The remote outcome is uncertain. Reconcile the existing draft; another post will not be created.',unsupported_content:'This browser connector does not support this article’s image or metadata. Configure a compatible connector or use a supported article version.',lease_expired:'The task authorization expired. No further publishing actions are allowed.',internal_error:'The browser task stopped unexpectedly. Review its diagnostic code.'};
  return messages[code]||messages.internal_error;
}
