export function effectiveInterval(count, requested = 90) {
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Select 1–1,000 websites.');
  if (!Number.isInteger(requested) || requested < 30 || requested > 86400) throw new Error('Interval must be between 30 and 86,400 seconds.');
  return count >= 100 ? Math.max(requested, Math.ceil(7200 / (count - 1))) : requested;
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
