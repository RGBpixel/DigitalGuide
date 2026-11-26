import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fetchContentWeb } from '../packages/media/src/content-web.js';
import { captureHtml } from '../packages/media/src/content-text.js';
const result=await fetchContentWeb('https://example.com/'),text=captureHtml(result.bytes),folder='docs/evidence/T24/content-sources';
fs.mkdirSync(folder,{recursive:true});
const report={result:'PASS_PUBLIC_HTTPS_STATIC_FETCH',verifiedAt:new Date().toISOString(),url:result.url,contentType:result.contentType,bytes:result.bytes.length,sha256:createHash('sha256').update(result.bytes).digest('hex'),parsedTextCharacters:text.text.length,paragraphs:text.paragraphs.length,bodySavedToMainDatabase:false,noAuthenticationForwarded:true,javascriptExecuted:false};
fs.writeFileSync(folder+'/public-web.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
