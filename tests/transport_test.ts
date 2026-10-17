import {request} from '../supabase/functions/_shared/network.ts';
const assert=(v:unknown,m='Assertion failed')=>{if(!v)throw new Error(m);};
async function mock(response:string,fn:(observed:any)=>Promise<void>,addresses=['8.8.8.8']){
  const old={resolveDns:Deno.resolveDns,connect:Deno.connect,startTls:Deno.startTls};
  const source=new TextEncoder().encode(response),observed:any={writes:[],connect:null,tls:null};let offset=0;
  const conn={read:async(b:Uint8Array)=>{if(offset===source.length)return null;const n=Math.min(17,b.length,source.length-offset);b.set(source.subarray(offset,offset+n));offset+=n;return n;},write:async(b:Uint8Array)=>{observed.writes.push(new TextDecoder().decode(b));return b.length;},close:()=>{}};
  Object.assign(Deno,{resolveDns:async()=>addresses,connect:async(options:any)=>{observed.connect=options;return conn;},startTls:async(_conn:any,options:any)=>{observed.tls=options;return conn;}});
  try{await fn(observed);}finally{Object.assign(Deno,old);}
}
Deno.test('TLS pins the validated address while preserving original certificate hostname',async()=>{
  await mock('HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n{"ok":true}',async observed=>{
    const r=await request('https://wordpress.com/wp-json/test');assert(r.data.ok);assert(observed.connect.hostname==='8.8.8.8');assert(observed.tls.hostname==='wordpress.com');assert(observed.writes.join('').includes('Host: wordpress.com\r\n'));
  });
});
Deno.test('Chunked JSON framing is decoded across partial socket reads',async()=>{
  await mock('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\n{"ok"\r\n6\r\n:true}\r\n0\r\n\r\n',async()=>assert((await request('https://wordpress.com/api')).data.ok));
});
Deno.test('Redirects are refused and truncated create responses remain uncertain',async()=>{
  await mock('HTTP/1.1 302 Found\r\nLocation: https://evil.com\r\nContent-Length: 0\r\n\r\n',async()=>{let caught=false;try{await request('https://wordpress.com/api');}catch(e){caught=String(e).includes('Redirect refused');}assert(caught);});
  await mock('HTTP/1.1 200 OK\r\nContent-Length: 99\r\n\r\n{}',async()=>{let caught=false;try{await request('https://wordpress.com/api','POST',{},'{}');}catch(e){caught=!!(e as any).uncertain;}assert(caught);});
});
Deno.test('Private DNS answers are blocked before any socket is opened',async()=>{
  await mock('',async observed=>{let caught=false;try{await request('https://wordpress.com/api');}catch{caught=true;}assert(caught);assert(observed.connect===null);},['169.254.169.254']);
});
