import {WordPress} from './wordpress.ts';
import {Ghost,Shopify,Webflow,Website,Credential,Runtime} from './connectors.ts';
import {Blogger,Wix,Drupal,Joomla,Custom} from './additional-connectors.ts';
import {RemoteError} from './network.ts';
export function connector(site:Website,credentials:Credential,runtime?:Runtime){
  if(site.cms_type==='wordpress')return new WordPress(site.api_endpoint,credentials as {username:string;password:string});
  const constructors={ghost:Ghost,shopify:Shopify,webflow:Webflow,blogger:Blogger,wix:Wix,drupal:Drupal,joomla:Joomla,custom:Custom};
  const Constructor=constructors[site.cms_type as keyof typeof constructors];
  if(!Constructor)throw new RemoteError('This website requires manual publishing.',400);
  return new Constructor(site,credentials,runtime);
}
