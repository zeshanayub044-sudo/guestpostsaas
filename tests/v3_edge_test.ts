import {binding,Website} from '../supabase/functions/_shared/connectors.ts';
const assert=(value:unknown)=>{if(!value)throw new Error('Assertion failed');};
Deno.test('browser credential binding survives nested JSONB key ordering',()=>{
  const site:Website={id:'fixture',website_url:'https://publisher.org',api_endpoint:'https://publisher.org',cms_type:'custom',connection_method:'browser',connection_version:7,connector_config:{browser_workflow:{id:'custom-editor-v1',paths:{login:'/login',editor:'/new'},selectors:{username:'#username',password:'#password'}}}};
  const fromDatabase:Website={...site,connector_config:{browser_workflow:{selectors:{password:'#password',username:'#username'},paths:{editor:'/new',login:'/login'},id:'custom-editor-v1'}}};
  assert(binding(site)===binding(fromDatabase));assert(binding(site)!==binding({...site,connection_version:8}));assert(binding(site)!==binding({...site,website_url:'https://other.org'}));
});
Deno.test('API binding keeps the V2 credential format',()=>{
  const site:Website={id:'fixture',website_url:'https://publisher.org',api_endpoint:'https://publisher.org/api',cms_type:'custom',connector_config:{z:'last',a:'first'},connection_method:'api',connection_version:8};
  assert(binding(site)===JSON.stringify(['custom','https://publisher.org','https://publisher.org/api',[['a','first'],['z','last']]]));
});
