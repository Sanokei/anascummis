import {join} from 'node:path';
import {mkdir,unlink} from 'node:fs/promises';
import {DATA,ROOT,db,asset} from './storage';
import {object,text,number} from './site';
export async function pdf(job:Record<string,unknown>):Promise<any>{
  const python=process.env.PYTHON_PATH || join(ROOT,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const p=Bun.spawn([python,join(ROOT,'worker/pdf_worker.py')],{stdin:'pipe',stdout:'pipe',stderr:'pipe',env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
  p.stdin.write(JSON.stringify(job));p.stdin.end();const timer=setTimeout(()=>p.kill(),60000);
  try{const [stdout,stderr,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);let data;try{data=JSON.parse(stdout);}catch{throw new Error(stderr.slice(-300)||'PDF engine unavailable; run bun run setup');}if(code||!data.ok)throw new Error(data.error||'PDF engine failed');return data.result;}finally{clearTimeout(timer);}
}
export function document(id:string){const d=db.query('SELECT * FROM documents WHERE id=?').get(id) as {id:string;name:string;revision:number;pages:number}|null;if(!d)throw new Error('PDF not found');return {...d,path:join(DATA,'documents',d.id,`${d.revision}.pdf`)};}
export function listDocuments(){return db.query('SELECT * FROM documents ORDER BY rowid DESC').all();}
export async function importPdf(name:string,bytes:Uint8Array){const id=crypto.randomUUID();await mkdir(join(DATA,'documents',id));const path=join(DATA,'documents',id,'0.pdf');await Bun.write(path,bytes);try{const info=await pdf({op:'inspect',input:path,args:{pages:[1]}});db.transaction(()=>{db.query('INSERT INTO documents VALUES(?,?,?,?)').run(id,name.slice(0,160),0,info.pageCount);db.query('INSERT INTO pdf_versions VALUES(?,?,?)').run(id,0,'Original');})();return document(id);}catch(e){await unlink(path).catch(()=>{});throw e;}}
export async function inspectPdf(id:string,pages:number[]=[1]){const d=document(id);return pdf({op:'inspect',input:d.path,args:{pages}});}
export const EDIT_OPS=['add_text','replace_text','redact','annotate','insert_image','rotate_pages','crop_page','select_pages','delete_pages','insert_page','fill_form','reflow','metadata'] as const;
export async function editPdf(id:string,op:string,args:unknown){
  if(!EDIT_OPS.includes(op as any))throw new Error('Unsupported PDF edit');
  const a=object(args); // All filesystem paths remain host supplied.
  if(op==='insert_image')text(a.assetId,100);
  const d=document(id),revision=d.revision+1,output=join(DATA,'documents',id,`${revision}.pdf`);
  try{
    const result=await pdf({op,input:d.path,output,args:a,...(op==='insert_image'?{image:asset(text(a.assetId,100)).path}:{})});
    const verification=await pdf({op:'inspect',input:output,args:{pages:[1]}});
    db.transaction(()=>{db.query('UPDATE documents SET revision=?,pages=? WHERE id=?').run(revision,verification.pageCount,id);db.query('INSERT INTO pdf_versions VALUES(?,?,?)').run(id,revision,op);})();
    return {revision,result,verification};
  }catch(e){await unlink(output).catch(()=>{});throw e;}
}
export async function renderPdf(id:string,page:number,dpi=100){number(page,1,500);number(dpi,36,300);const d=document(id);const output=join(DATA,'exports',`${crypto.randomUUID()}.png`);await pdf({op:'render',input:d.path,output,args:{page,dpi}});return output;}
export async function imagesToPdf(ids:string[],name:string){if(!ids.length||ids.length>100)throw new Error('Choose 1–100 uploaded images');const output=join(DATA,'exports',`${crypto.randomUUID()}.pdf`);try{await pdf({op:'images_to_pdf',images:ids.map(id=>asset(id).path),output,args:{}});return await importPdf(name,new Uint8Array(await Bun.file(output).arrayBuffer()));}finally{await unlink(output).catch(()=>{});}}
