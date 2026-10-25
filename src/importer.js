import {read,utils} from 'xlsx';

export const fields={website_url:'Website URL',account_email:'Account email / username',cms_type:'CMS',website_name:'Website name',category:'Category',language:'Language',country:'Country'};
const key=s=>String(s??'').replace(/^\uFEFF/,'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases={website_url:['websiteurl','website','url','domain','site','siteurl','webaddress'],account_email:['accountemail','email','account','username','accountusername'],cms_type:['cms','cmstype','platform','contentmanagementsystem'],website_name:['websitename','name','sitename'],category:['category','niche','topic','industry'],language:['language','lang'],country:['country','region']};
export function assertSafeHeaders(headers){if(headers.some(h=>/password|passwd|passcode|secret|token|credential|apikey|authorization|cookie|session|^pwd$|^pass$/i.test(key(h))))throw new Error('Remove password, token and other credential columns before importing. Connect publishing accounts securely after import.');}
export function suggestMapping(headers){assertSafeHeaders(headers);return Object.fromEntries(Object.keys(fields).map(f=>[f,headers.findIndex(h=>aliases[f].includes(key(h)))]));}
export function normalizeImportURL(value){
  let raw=String(value??'').trim();if(!raw)throw new Error('Website URL is missing.');
  if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw))raw='https://'+raw;
  const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!u.hostname.includes('.')||/^[\d.]+$/.test(u.hostname)||u.hostname.includes(':')||u.hostname.endsWith('.')||/(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(u.hostname))throw new Error('Use a public HTTPS website domain.');
  u.hash='';u.search='';return u.href.replace(/\/$/,'');
}
export const domainKey=value=>new URL(normalizeImportURL(value)).hostname.replace(/^www\./,'');
export function mapImportRows(headers,rows,mapping=suggestMapping(headers)){
  assertSafeHeaders(headers);if(mapping.website_url<0||mapping.website_url==null)throw new Error('Map a Website URL column.');
  if(rows.length<1||rows.length>500)throw new Error('Choose a sheet with 1–500 website rows.');
  const seen=new Set();return rows.map((values,i)=>{const row={row_number:i+2};for(const f of Object.keys(fields))row[f]=String(values[mapping[f]]??'').trim();
    try{row.website_url=normalizeImportURL(row.website_url);const domain=domainKey(row.website_url);row.preview_status=seen.has(domain)?'duplicate':'ready';seen.add(domain);}catch(e){row.preview_status='invalid';row.message=e.message;}
    return row;
  });
}
export function readSpreadsheet(buffer,name){
  if(!/\.(xlsx|xls|csv)$/i.test(name))throw new Error('Choose an .xlsx, .xls or .csv spreadsheet.');
  if(buffer.byteLength>5*1024*1024)throw new Error('Spreadsheet exceeds 5 MB.');
  const book=read(buffer,{type:'array',cellFormula:false,cellHTML:false,cellNF:false,bookVBA:false,sheetRows:503});
  if(!book.SheetNames.length)throw new Error('The spreadsheet has no worksheets.');
  return book.SheetNames.map(name=>{const sheet=book.Sheets[name],data=utils.sheet_to_json(sheet,{header:1,raw:false,defval:'',blankrows:false});const headers=(data.shift()||[]).map(String);assertSafeHeaders(headers);if(data.length>500)throw new Error('Import up to 500 data rows per sheet.');return {name,headers,rows:data};});
}
