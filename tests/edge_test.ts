import {cleanHTML,canonicalURL,articleData} from '../supabase/functions/_shared/core.ts';
import {publicIP} from '../supabase/functions/_shared/network.ts';
const assert=(value:unknown,message='Assertion failed')=>{if(!value)throw new Error(message);};
Deno.test('server sanitizer strips scripts, handlers and unsafe URLs',()=>{
  const html=cleanHTML('<h2>Safe</h2><script>alert(1)</script><img src="https://cdn.test/pic.png" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><iframe src="https://evil.test"></iframe>');
  assert(html.includes('<h2>Safe</h2>'));assert(!/script|onerror|javascript|iframe/.test(html));
});
Deno.test('website validation rejects internal, insecure and credential-bearing endpoints',()=>{
  for(const url of ['http://example.com','https://127.0.0.1','https://[::1]','https://localhost','https://a.internal','https://user:pass@domain.com','https://domain.com:8443','https://domain.com/#secret']){let rejected=false;try{canonicalURL(url);}catch{rejected=true;}assert(rejected,url);}
});
Deno.test('IP classifier rejects all private and special-use ranges',()=>{
  for(const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.0.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1'])assert(!publicIP(address),address);
  assert(publicIP('8.8.8.8'));
});
Deno.test('article API cannot grant editorial approval on save',()=>{const a=articleData({title:'Test',content:'<p>Body</p>',status:'approved',tags:'one,two'});assert(a.status==='draft');assert(a.tags.length===2);});
