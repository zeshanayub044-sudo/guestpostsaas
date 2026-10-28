export function publicDiscovery(page,sourceURL){
 if(!page)return {platform:'custom',detected:false,report:{native_api:'not_detected',platform_connector:'not_verified',authentication:'not_tested',publishing_permission:'not_verified',recommended_action:'A safe public response is required before connector discovery.'}};
 const html=page.html||'',lower=html.toLowerCase(),headers=page.headers||{},host=new URL(page.url||sourceURL).hostname;let platform='custom';
 if(/wp-content\/|wp-includes\//i.test(html)||/api\.w\.org/.test(headers.link||''))platform='wordpress';
 else if(/blogspot\./i.test(host)||/generator[^>]+blogger/i.test(html))platform='blogger';
 else if(headers['x-wix-request-id']||/wixstatic\.com/.test(lower))platform='wix';
 else if(/data-wf-site=/.test(lower))platform='webflow';
 else if(host.endsWith('.myshopify.com')||/cdn\.shopify\.com/.test(lower))platform='shopify';
 else if(/generator[^>]+ghost|ghost\/api\//i.test(html))platform='ghost';
 else if(/drupal/i.test(headers['x-generator']||'')||/generator[^>]+drupal/i.test(html))platform='drupal';
 else if(/generator[^>]+joomla/i.test(html))platform='joomla';
 return {platform,detected:platform!=='custom',resolved_url:page.url,checked_at:new Date().toISOString(),report:{native_api:platform!=='custom'?'public_cms_signal_only':'not_detected',platform_connector:platform!=='custom'?'available':'requires_configuration',authentication:'not_tested',publishing_permission:'not_verified',browser_workflow:'not_verified',method:'Public homepage signal; no account login or publishing attempted.',recommended_action:platform!=='custom'?'Connect a dedicated authorized '+platform+' publishing credential and verify its create/publish rights.':'No supported CMS was established from the public page. Configure an approved API or permitted browser workflow.'}};
}
