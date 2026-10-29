import {Database} from 'bun:sqlite';
import {mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {initialSite,validateSite,type Site} from './site';
export const ROOT=resolve(import.meta.dir,'..');
export const DATA=resolve(process.env.STUDIO_DATA || join(ROOT,'.data'));
for(const name of ['','assets','documents','exports'])await mkdir(join(DATA,name),{recursive:true});
export const db=new Database(join(DATA,'studio.sqlite'),{create:true});
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT,revision INTEGER);
CREATE TABLE IF NOT EXISTS versions(project TEXT,revision INTEGER,body TEXT,label TEXT,created TEXT,PRIMARY KEY(project,revision));
CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,name TEXT,mime TEXT);
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,name TEXT,revision INTEGER,pages INTEGER);
CREATE TABLE IF NOT EXISTS pdf_versions(doc TEXT,revision INTEGER,label TEXT,PRIMARY KEY(doc,revision));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,project TEXT,role TEXT,content TEXT);`);
export function listProjects(){return db.query('SELECT * FROM projects ORDER BY rowid DESC').all();}
export function getProject(id:string){const p=db.query('SELECT * FROM projects WHERE id=?').get(id) as {id:string;name:string;revision:number}|null;if(!p)throw new Error('Project not found');const v=db.query('SELECT body FROM versions WHERE project=? AND revision=?').get(id,p.revision) as {body:string};return {...p,site:validateSite(JSON.parse(v.body))};}
export function createProject(name:string){const id=crypto.randomUUID(),site=initialSite();site.name=name.slice(0,160)||site.name;db.transaction(()=>{db.query('INSERT INTO projects VALUES(?,?,?)').run(id,site.name,0);db.query('INSERT INTO versions VALUES(?,?,?,?,?)').run(id,0,JSON.stringify(site),'Original',new Date().toISOString());})();return getProject(id);}
export function saveProject(id:string,site:Site,label:string){validateSite(site);const p=getProject(id);const revision=p.revision+1;db.transaction(()=>{db.query('INSERT INTO versions VALUES(?,?,?,?,?)').run(id,revision,JSON.stringify(site),label,new Date().toISOString());db.query('UPDATE projects SET name=?,revision=? WHERE id=?').run(site.name,revision,id);})();return getProject(id);}
export function history(id:string){getProject(id);return db.query('SELECT revision,label,created FROM versions WHERE project=? ORDER BY revision DESC').all(id);}
export function restore(id:string,revision:number){getProject(id);const v=db.query('SELECT body FROM versions WHERE project=? AND revision=?').get(id,revision) as {body:string}|null;if(!v)throw new Error('Revision not found');return saveProject(id,validateSite(JSON.parse(v.body)),`Restore version ${revision}`);}
const busy=new Set<string>();
export async function exclusive<T>(id:string,run:()=>Promise<T>,signal?:AbortSignal):Promise<T>{while(busy.has(id)){if(!signal)throw new Error('This item is busy');signal.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,50));}signal?.throwIfAborted();busy.add(id);try{return await run();}finally{busy.delete(id);}}
export function asset(id:string){const a=db.query('SELECT * FROM assets WHERE id=?').get(id) as {id:string;name:string;mime:string}|null;if(!a)throw new Error('Image not found');return {...a,path:join(DATA,'assets',a.id)};}
export function listAssets(){return db.query('SELECT * FROM assets ORDER BY rowid DESC').all() as {id:string;name:string;mime:string}[];}
