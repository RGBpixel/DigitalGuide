import { ZipFile } from 'yazl';
export async function originalWordContentFixture(body?:string,macro=false) {
  const zip=new ZipFile();
  zip.addBuffer(Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="'+(macro?'application/vnd.ms-word.document.macroEnabled.main+xml':'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')+'"/></Types>'),'[Content_Types].xml');
  zip.addBuffer(Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),'_rels/.rels');
  zip.addBuffer(Buffer.from('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+(body??'<w:p><w:r><w:t>原创合成讲稿：欢迎来到数字导览展厅。</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格中的讲解要点。</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')+'</w:body></w:document>'),'word/document.xml');
  const output=new Promise<Buffer>((resolve,reject)=>{const chunks:Buffer[]=[];zip.outputStream.on('data',(chunk:Buffer)=>chunks.push(chunk));zip.outputStream.on('error',reject);zip.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));});
  zip.end();return output;
}
