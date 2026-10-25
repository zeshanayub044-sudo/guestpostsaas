// Bounded HTTP/1.1 over a DNS-pinned TLS socket. No redirects or secondary DNS lookup.
import ipaddr from 'ipaddr.js';
import {canonicalURL} from './core.ts';
export class RemoteError extends Error {
  location?:string;
  constructor(message:string,public status=0,public retryAfter=0,public uncertain=false){super(message);}
}
export function publicIP(address:string):boolean {
  try{return ipaddr.parse(address).range()==='unicast';}catch{return false;}
}
const encoder=new TextEncoder(),decoder=new TextDecoder();
export async function request(url:string,method='GET',headers:Record<string,string>={},body?:string|Uint8Array,timeoutMs=25000,format:'json'|'text'='json'):Promise<{status:number;headers:Record<string,string>;data:any}>{
  const u=canonicalURL(url),mutates=['POST','PUT','PATCH','DELETE'].includes(method);
  const payload=body===undefined?new Uint8Array():typeof body==='string'?encoder.encode(body):body;
  let socket:Deno.Conn|Deno.TlsConn|undefined,timedOut=false,timer:number|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;try{socket?.close();}catch{/* closed */}reject(new RemoteError('HTTPS request timed out.',0,0,mutates));},timeoutMs);});
  const assertOpen=()=>{if(timedOut){try{socket?.close();}catch{/* closed */}throw new RemoteError('HTTPS request timed out.',0,0,mutates);}};
  const perform=async()=>{
    const addresses=await Deno.resolveDns(u.hostname,'A');assertOpen();
    if(!addresses.length||addresses.some(a=>!publicIP(a)))throw new RemoteError('The domain must resolve exclusively to public IPv4 addresses.');
    const plain=await Deno.connect({hostname:addresses[0],port:443});socket=plain;assertOpen();
    socket=await Deno.startTls(plain,{hostname:u.hostname,alpnProtocols:['http/1.1']});assertOpen();
    const requestHeaders:Record<string,string>={Host:u.hostname,Connection:'close',Accept:'application/json','Accept-Encoding':'identity',...headers};
    if(payload.length||method==='POST')requestHeaders['Content-Length']=String(payload.length);
    for(const [name,value]of Object.entries(requestHeaders))if(!/^[A-Za-z0-9-]+$/.test(name)||/[\r\n]/.test(value))throw new RemoteError('Invalid HTTP header.');
    const head=encoder.encode(`${method} ${u.pathname}${u.search} HTTP/1.1\r\n`+Object.entries(requestHeaders).map(([k,v])=>`${k}: ${v}\r\n`).join('')+'\r\n');
    for(const bytes of [head,payload]){let offset=0;while(offset<bytes.length){assertOpen();offset+=await socket.write(bytes.subarray(offset));}}
    let pending=new Uint8Array(),totalRead=0;
    const more=async()=>{
      assertOpen();const buffer=new Uint8Array(65536);const n=await socket!.read(buffer);if(n===null)return false;
      totalRead+=n;if(totalRead>6*1024*1024+65536)throw new RemoteError('Remote response exceeded size limit.',0,0,mutates);
      const next=new Uint8Array(pending.length+n);next.set(pending);next.set(buffer.subarray(0,n),pending.length);pending=next;return true;
    };
    const line=async(max=8192):Promise<string>=>{
      while(true){for(let i=0;i<pending.length-1;i++)if(pending[i]===13&&pending[i+1]===10){if(i>max)throw new RemoteError('Remote header exceeded size limit.');const value=decoder.decode(pending.subarray(0,i));pending=pending.slice(i+2);return value;}
        if(pending.length>max||!await more())throw new RemoteError('Incomplete HTTP response.',0,0,mutates);
      }
    };
    const exact=async(n:number):Promise<Uint8Array>=>{if(!Number.isSafeInteger(n)||n<0||n>6*1024*1024)throw new RemoteError('Invalid remote response length.',0,0,mutates);while(pending.length<n)if(!await more())throw new RemoteError('Remote response was interrupted.',0,0,mutates);const out=pending.slice(0,n);pending=pending.slice(n);return out;};
    let status=0,h:Record<string,string>={};
    for(let interim=0;interim<5;interim++){
      const match=(await line()).match(/^HTTP\/1\.[01] (\d{3})(?: |$)/);if(!match)throw new RemoteError('Invalid HTTP status line.',0,0,mutates);status=Number(match[1]);h={};let headerBytes=0;
      for(let count=0;count<100;count++){
        const value=await line();headerBytes+=value.length;if(headerBytes>32768)throw new RemoteError('Remote headers exceeded size limit.');if(!value)break;
        const colon=value.indexOf(':');if(colon<1||/^[ \t]/.test(value))throw new RemoteError('Invalid remote header.');const name=value.slice(0,colon).toLowerCase(),v=value.slice(colon+1).trim();
        if(name==='content-length'&&h[name]&&h[name]!==v)throw new RemoteError('Conflicting remote response lengths.');h[name]=v;if(count===99)throw new RemoteError('Too many remote headers.');
      }
      if(status>=200)break;
    }
    if(status<200)throw new RemoteError('Invalid informational response.');
    if(status>=300&&status<400){const error=new RemoteError('Redirect refused. Use the final HTTPS API URL.',status);error.location=h.location;throw error;}
    const raw=h['retry-after'];const wait=raw?Math.max(0,/^\d+$/.test(raw)?Number(raw):Math.ceil((Date.parse(raw)-Date.now())/1000)):0;
    if(h['content-encoding']&&h['content-encoding']!=='identity')throw new RemoteError('Unsupported remote content encoding.',status,0,mutates);
    if(h['transfer-encoding']&&h['content-length'])throw new RemoteError('Ambiguous remote HTTP framing.',status,0,mutates);
    const chunks:Uint8Array[]=[];let size=0;
    const add=(part:Uint8Array)=>{size+=part.length;if(size>6*1024*1024)throw new RemoteError('Remote response exceeded size limit.',0,0,mutates);chunks.push(part);};
    if(h['transfer-encoding']){
      if(h['transfer-encoding'].toLowerCase()!=='chunked')throw new RemoteError('Unsupported remote transfer encoding.',status,0,mutates);
      while(true){const header=await line();const hex=header.split(';')[0];if(!/^[a-f0-9]+$/i.test(hex))throw new RemoteError('Invalid chunk framing.',status,0,mutates);const n=parseInt(hex,16);if(n===0){for(let trailers=0;trailers<100;trailers++){if(!await line())break;if(trailers===99)throw new RemoteError('Too many HTTP trailers.');}break;}add(await exact(n));const crlf=await exact(2);if(crlf[0]!==13||crlf[1]!==10)throw new RemoteError('Invalid chunk terminator.',status,0,mutates);}
    }else if(h['content-length']){
      if(!/^\d+$/.test(h['content-length']))throw new RemoteError('Invalid remote content length.',status,0,mutates);add(await exact(Number(h['content-length'])));
    }else{
      add(pending);pending=new Uint8Array();while(await more()){add(pending);pending=new Uint8Array();}
    }
    const response=new Uint8Array(size);let offset=0;for(const c of chunks){response.set(c,offset);offset+=c.length;}
    let data:any;try{data=format==='text'?decoder.decode(response):size===0&&status>=200&&status<300?null:JSON.parse(decoder.decode(response));}catch{if(status>=400)throw new RemoteError(`Publishing API returned HTTP ${status}.`,status,Math.min(604800,wait||0),mutates&&status>=500);throw new RemoteError('The website returned an invalid JSON response.',status,0,mutates);}
    if(status>=400)throw new RemoteError(`Publishing API returned HTTP ${status}${data?.code?` (${String(data.code).replace(/[^a-z0-9_]/gi,'').slice(0,60)})`:''}.`,status,Math.min(604800,wait||0),mutates&&status>=500);
    return {status,headers:h,data};
  };
  try{return await Promise.race([perform(),timeout]);}
  catch(e){if(e instanceof RemoteError)throw e;throw new RemoteError('Could not complete the HTTPS request.',0,0,mutates);}
  finally{clearTimeout(timer);try{socket?.close();}catch{/* closed */}}
}
