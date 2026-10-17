import { createClient } from '@supabase/supabase-js';
import sanitizeHtml from 'sanitize-html';

export const db = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(20000),...(init?.signal?[init.signal]:[])])})}});
export function cleanHTML(input: unknown): string {
  return sanitizeHtml(String(input ?? ''), {
    allowedTags: ['p','br','h1','h2','h3','h4','h5','h6','strong','b','em','i','u','s','a','ul','ol','li','blockquote','pre','code','hr','img','table','thead','tbody','tr','th','td','figure','figcaption'],
    allowedAttributes: {a:['href','title'],img:['src','alt','width','height'],th:['colspan','rowspan'],td:['colspan','rowspan']},
    allowedSchemes:['https','mailto'],allowProtocolRelative:false,
    transformTags:{a:sanitizeHtml.simpleTransform('a',{rel:'noopener noreferrer'})}
  });
}
export function text(value: unknown, max = 200, required = false): string {
  const s=String(value??'').trim();
  if(s.length>max || (required && !s)) throw new Error(`Text must be ${required?'1':'0'}–${max} characters.`);
  return s;
}
export function integer(v: unknown, min: number, max: number): number {
  const n=Number(v); if(!Number.isInteger(n)||n<min||n>max) throw new Error(`Number must be between ${min} and ${max}.`); return n;
}
export const uuid=(v: unknown): string=> {const s=String(v);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s))throw new Error('Invalid record ID.');return s;};
export function canonicalURL(value: unknown): URL {
  const u=new URL(String(value));
  if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port&&u.port!=='443'||u.hostname.endsWith('.')||!u.hostname.includes('.')||/^[\d.]+$/.test(u.hostname)||u.hostname.includes(':')) throw new Error('Use a public HTTPS domain on port 443.');
  if(/(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(u.hostname))throw new Error('Internal or reserved domains are not supported.');
  return u;
}
export function articleData(raw: Record<string,unknown>) {
  return {title:text(raw.title,300,true),content:cleanHTML(text(raw.content,500000,true)),meta_title:text(raw.meta_title,200),meta_description:text(raw.meta_description,500),slug:text(raw.slug,120).toLowerCase().replace(/[^a-z0-9-]/g,'-'),focus_keyword:text(raw.focus_keyword,200),featured_image:raw.featured_image?canonicalURL(raw.featured_image).href:null,canonical_url:raw.canonical_url?canonicalURL(raw.canonical_url).href:null,category:text(raw.category,100),tags:(Array.isArray(raw.tags)?raw.tags:String(raw.tags??'').split(',')).filter(Boolean).slice(0,30).map(t=>text(t,80)),status:['draft','review'].includes(String(raw.status))?String(raw.status):'draft'};
}
export async function rpc(name: string, args: Record<string,unknown>={}) {
  const {data,error}=await db().rpc(name,args);if(error)throw new Error(error.message);return data;
}
