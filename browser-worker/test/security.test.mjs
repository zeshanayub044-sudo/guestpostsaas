import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {publicAddress,approvedOrigin,pinnedProxy} from '../src/network.mjs';
import {browserWorkflow,browserDiscovery,connectionLabel} from '../../supabase/functions/_shared/browser-contract.mjs';
import {automaticallyEligible} from '../../src/v3.js';
test('browser egress rejects private and special-use addresses',()=>{for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.0.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','fc00::1','::ffff:127.0.0.1'])assert.equal(publicAddress(ip),false,ip);assert.equal(publicAddress('8.8.8.8'),true);});
test('browser origin validation prevents URL and network credential tricks',()=>{for(const url of ['http://domain.com','https://localhost','https://a.internal','https://127.0.0.1','https://[::1]','https://u:p@domain.com','https://domain.com:444','https://domain.com.'])assert.throws(()=>approvedOrigin(url));assert.equal(approvedOrigin('https://publisher.org/path'),'https://publisher.org');});
test('CONNECT proxy never opens a socket for private DNS or a different host',async()=>{
  let connected=0;const proxy=await pinnedProxy('https://publisher.org',{resolve:async()=>[{address:'10.0.0.1'}],connect:()=>{connected++;throw new Error('Must not connect');}});
  try{for(const host of ['publisher.org:443','metadata.internal:443','publisher.org:80']){const status=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:new URL(proxy.url).port,method:'CONNECT',path:host});req.on('connect',(res,socket)=>{socket.destroy();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(status,403);}assert.equal(connected,0);}finally{await proxy.close();}
});
test('discovery cannot load arbitrary script workflows or cross-origin editor paths',()=>{
  assert.equal(browserWorkflow('custom',{id:'execute-js',protocol:'guestpost.browser.v1',automation_permitted:true},'https://publisher.org'),null);
  const wp=browserWorkflow('wordpress',null,'https://publisher.org/blog');assert.equal(wp.paths.login,'/blog/wp-login.php');assert.equal(wp.capabilities.featured_image,false);
  const manifest={...wp,id:'custom-editor-v1',paths:{...wp.paths,login:'//evil.org/login'}};assert.throws(()=>browserWorkflow('custom',manifest,'https://publisher.org'));
});
test('browser eligibility needs a verified connection and a live worker',()=>{
  const site={status:'active',connection_status:'connected',permission_status:'verified',cms_type:'custom',connection_method:'browser'};
  assert.equal(automaticallyEligible(site,[]),false);assert.equal(automaticallyEligible(site,[{active:true,last_seen_at:new Date().toISOString()}]),true);assert.equal(automaticallyEligible({...site,connection_status:'checking'},[{active:true,last_seen_at:new Date().toISOString()}]),false);
  assert.equal(connectionLabel(site),'Browser Connected');assert.equal(connectionLabel({...site,connection_method:'api'}),'API Connected');assert.equal(connectionLabel({connection_status:'setup_required'}),'Connector Setup Required');
  assert.equal(automaticallyEligible({...site,permission_status:'credential_verified'},[{active:true,last_seen_at:new Date().toISOString()}]),false);
});
test('an explicit destination prohibition blocks even the WordPress browser fallback',()=>{
  const denied={protocol:'guestpost.browser.v1',automation_permitted:false};
  for(const platform of ['wordpress','custom'])assert.deepEqual(browserDiscovery(platform,denied,'https://publisher.org'),{workflow:null,policy:'not_permitted'});
  assert.equal(browserDiscovery('wordpress',null,'https://publisher.org').workflow.id,'wordpress-classic-v1');
});
