import http from 'node:http';
import net from 'node:net';
import {lookup} from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export function publicAddress(value){try{return ipaddr.parse(value).range()==='unicast';}catch{return false;}}
export function approvedOrigin(value){
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!u.hostname.includes('.')||net.isIP(u.hostname)||u.hostname.endsWith('.')||/(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(u.hostname))throw new Error('Unsafe publishing origin.');
  return u.origin;
}
// Chromium connects only to this proxy. Each CONNECT resolves once, checks every
// returned address, and pins the TCP connection to a public IP. TLS remains end-to-end.
export async function pinnedProxy(origin,{resolve=lookup,connect=net.connect}={}){
  const allowed=new URL(approvedOrigin(origin));const sockets=new Set();
  const server=http.createServer((_req,res)=>{res.writeHead(403);res.end();});
  server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.setTimeout(30000,()=>s.destroy());});
  server.on('connect',async(req,client,head)=>{
    let upstream;
    try{
      if(req.url!==allowed.hostname+':443')throw new Error('Origin not allowed');
      const records=await resolve(allowed.hostname,{all:true,family:4});
      if(!records.length||records.some(r=>!publicAddress(r.address)))throw new Error('Private address refused');
      upstream=connect({host:records[0].address,port:443});sockets.add(upstream);upstream.setTimeout(30000,()=>upstream.destroy());
      upstream.once('connect',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});
      upstream.on('error',()=>client.destroy());upstream.on('close',()=>sockets.delete(upstream));client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());
    }catch{client.end('HTTP/1.1 403 Forbidden\r\n\r\n');upstream?.destroy();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:'http://127.0.0.1:'+server.address().port,close:async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
