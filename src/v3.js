import {connectionLabel} from '../supabase/functions/_shared/browser-contract.mjs';
export {connectionLabel};
export function workerOnline(workers=[]){return workers.some(w=>w.active&&Date.parse(w.last_seen_at)>Date.now()-120000);}
export function automaticallyEligible(site,workers=[]){return site.status==='active'&&site.connection_status==='connected'&&site.cms_type!=='manual'&&(site.connection_method!=='browser'||workerOnline(workers));}
export function connectionReport(site,esc){
  const report=site.connection_report||site.report||{};
  const row=(name,value)=>`<div><dt>${esc(name)}</dt><dd>${esc(String(value||'Not checked').replaceAll('_',' '))}</dd></div>`;
  return `<section class="connection-report"><h3>Website Connection Report</h3><dl>${row('Website',site.website_url||'')}${row('CMS detected',site.cms_type||site.platform||'Unknown')}${row('Native API',report.native_api)}${row('Platform connector',report.platform_connector)}${row('Permitted browser workflow',report.browser_workflow)}${row('Publishing status',connectionLabel({connection_status:site.connection_status||site.status,connection_method:site.connection_method}))}</dl><p>${esc(site.connection_message||site.message||report.recommended_action||'Configure and verify an authorized publishing workflow.')}</p></section>`;
}
export function bindWorkerSettings(ctx){
  const {$,$$,api,run,modal,confirmAction,esc,state}=ctx;
  $('#manage-workers')?.addEventListener('click',()=>run(async()=>{
    const r=await api('worker.status',{});
    modal('Browser publishing workers',`<p>Run the dedicated service on your server. Keep its token in the server secret store.</p><div class="worker-list">${r.workers.map(w=>`<div><strong>${esc(w.name)}</strong><small>${w.active?(workerOnline([w])?'Online':'Offline'):'Revoked'}</small>${w.active?`<button class="btn small" data-revoke-worker="${w.id}">Revoke</button>`:''}</div>`).join('')||'<p>No workers registered.</p>'}</div><label>New worker name<input id="worker-name" maxlength="100" value="Publishing worker"></label><button class="btn primary" id="register-worker">Register worker</button><div id="worker-enrollment" role="status"></div>`);
    $$('[data-revoke-worker]').forEach(b=>b.onclick=()=>confirmAction('Revoke browser worker','This server will lose task access. In-flight browser actions may already have reached the destination.',()=>api('worker.revoke',{id:b.dataset.revokeWorker}),'Revoke worker'));
    $('#register-worker').onclick=e=>run(async()=>{const created=await api('worker.register',{name:$('#worker-name').value});$('#worker-enrollment').innerHTML=`<div class="notice">Copy this token into your server secret store now. It is shown only once.</div><label>Gateway URL<input readonly value="${esc(created.gateway)}"></label><label>Worker token<input readonly type="password" value="${esc(created.token)}" autocomplete="off"></label><button class="btn small" id="show-worker-token">Show token</button><p>Deployment instructions: browser-worker/README.md.</p>`;$('#show-worker-token').onclick=()=>{$('#worker-enrollment input[type=password]').type='text';$('#show-worker-token').remove();};$('#register-worker').hidden=true;},e.currentTarget);
  }));
}
