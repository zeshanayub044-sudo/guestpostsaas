export const MIN_INTERVAL = 300;
export const MAX_PUBLICATIONS = 500;
export function effectiveInterval(count, requested = MIN_INTERVAL) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_PUBLICATIONS) throw new Error('Choose between 1 and 500 publications.');
  if (!Number.isInteger(requested) || requested < MIN_INTERVAL || requested > 86400) throw new Error('Publishing interval must be between 5 minutes and 24 hours.');
  return requested;
}
export function campaignEstimate(count, interval = MIN_INTERVAL, started = Date.now()) {
  interval = effectiveInterval(count, interval);
  return { first: new Date(Number(started) + interval * 1000), last: new Date(Number(started) + count * interval * 1000), seconds: count * interval };
}
export function parseCSV(input) {
  if (input.length > 1000000) throw new Error('CSV exceeds 1 MB.');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') { if (quoted && input[i + 1] === '"') { cell += '"'; i++; } else if (!cell || quoted) quoted = !quoted; else throw new Error('Invalid CSV quoting.'); }
    else if (!quoted && (c === ',' || c === '\n' || c === '\r')) { row.push(cell); cell = ''; if (c !== ',') { if (row.some(v => v.trim())) rows.push(row); row = []; if (c === '\r' && input[i + 1] === '\n') i++; } }
    else cell += c;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  const headers = (rows.shift() || []).map(v => v.replace(/^\uFEFF/, '').trim().toLowerCase());
  if (!headers.includes('website_url')) throw new Error('CSV needs a website_url column.');
  if (headers.some(h => /password|secret|token|credential/.test(h))) throw new Error('Import website details only. Connect accounts securely after import.');
  if (rows.length > 500) throw new Error('Import up to 500 websites at a time.');
  return rows.map((values, i) => { if (values.length !== headers.length) throw new Error(`CSV row ${i + 2} has the wrong number of columns.`); return Object.fromEntries(headers.map((key, j) => [key, values[j].trim()])); });
}
export function duration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(' ');
}
export function csv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const cell = value => {
    let s = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return [keys, ...rows.map(r => keys.map(k => r[k]))].map(r => r.map(cell).join(',')).join('\r\n');
}
