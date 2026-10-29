import {rpc} from '../_shared/core.ts';
import {processDiscovery} from '../_shared/inventory.ts';
import {processQualification} from '../_shared/qualification.ts';
import {settleQualificationBatch} from '../_shared/qualification-batch.mjs';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const token=req.headers.get('x-scheduler-token');if(!token||token.length<32||!await rpc('verify_worker_token',{p_token:token}))return new Response('Unauthorized',{status:401});
 try{const batch=await settleQualificationBatch(processQualification);if(batch.failed)return Response.json({...batch,error:'Some read-only checks did not finish; their durable leases will be retried.'},{status:500});return Response.json(batch.processed?batch:{...batch,legacy_discovery:await processDiscovery()});}catch{return Response.json({error:'Qualification could not complete; its durable lease will be retried.'},{status:500});}
});
