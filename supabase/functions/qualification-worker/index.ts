import {rpc} from '../_shared/core.ts';
import {processDiscovery} from '../_shared/inventory.ts';
import {processQualification} from '../_shared/qualification.ts';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const token=req.headers.get('x-scheduler-token');if(!token||token.length<32||!await rpc('verify_worker_token',{p_token:token}))return new Response('Unauthorized',{status:401});
 try{const results=await Promise.all(Array.from({length:8},()=>processQualification()));const processed=results.reduce((n,r)=>n+r.processed,0);return Response.json(processed?{processed,results}:{processed:0,legacy_discovery:await processDiscovery()});}catch{return Response.json({error:'Qualification could not complete; its durable lease will be retried.'},{status:500});}
});
