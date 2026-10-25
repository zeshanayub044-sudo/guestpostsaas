import type {Website,Runtime} from './connectors.ts';
import {canonicalURL} from './core.ts';
import {RemoteError} from './network.ts';
export async function permissionBridge(site:Website,headers:Record<string,string>,rt:Runtime){
  let endpoint=site.connector_config.permission_endpoint;
  if(!endpoint&&site.cms_type==='drupal')endpoint=site.website_url.replace(/\/$/,'')+'/guestpost/v1/capabilities';
  if(!endpoint)return null;
  const url=canonicalURL(endpoint);if(url.origin!==new URL(site.website_url).origin)throw new RemoteError('The permission bridge must belong to this website.',400);
  if(site.cms_type==='drupal'){url.searchParams.set('bundle',site.connector_config.bundle);url.searchParams.set('text_format',site.connector_config.text_format);}
  const {data}=await rt.http(url.href,'GET',headers);
  if(data?.protocol!=='guestpost.permissions.v1'||data.platform!==site.cms_type||data.authenticated!==true||!data.account_id)throw new RemoteError('The destination permission bridge did not verify this account.',403);
  if(site.cms_type==='drupal'&&(data.bundle!==site.connector_config.bundle||data.text_format!==site.connector_config.text_format)||site.cms_type==='joomla'&&String(data.category_id)!==String(site.connector_config.category_id))throw new RemoteError('The permission bridge checked a different content type or category.',400);
  if(data.permissions?.create!==true||data.permissions?.publish!==true)throw new RemoteError(data.workflow_requires_configuration?'This account needs a configured moderation transition before automatic publication.':'The destination account is missing create or publish permission.',403);
  return {account:String(data.account_id),permission_status:'verified',message:'Authenticated create and publish permissions verified by the destination capability bridge.'};
}
