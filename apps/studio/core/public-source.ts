import type {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {safeFetch, publicAddress} from './network';
import {fetchWithoutRedirects} from './fetch-without-redirects';
import {selectSourcePassages,utf16Boundary} from './source-passages';
import type {GoalExecution,GoalReview,GoalTask} from './goal-orchestrator';

export type SourceSnapshot = {
  id: string; goalId: string; taskId: string; requestedUrl: string; url: string; title: string;
  retrievedAt: string; type: string; bytes: number; textLength: number;
  sha256: string; textSha256: string; normalization: 'public-text-v1';
  copiedFrom?: {goalId:string;sourceId:string};
};
export type PublicPage = Omit<SourceSnapshot, 'id' | 'goalId' | 'taskId'> & {body: Uint8Array; text: string};
export type SourceProgress = (phase: 'fetching_source' | 'source_saved' | 'source_reused' | 'selection_saved' | 'selection_reused' | 'answering_sources', detail: string) => void;
export type SourceRangeInput={sourceId:string;start:number;end:number;textSha256:string};
export type SourceReadingResult={id:string;goalId:string;taskId:string;readingId?:string;question:string;attempt:number;created:number;status:GoalTask['status'];execution:GoalExecution;review?:GoalReview};
export type SourceReadingPlan={id:string;goalId:string;taskId:string;version:'source-passages-v1';mode:'auto'|'manual';question:string;questionSha256:string;created:number;match:'matched'|'none'|'manual';ranges:(SourceRangeInput&{label:string;rangeSha256:string;text:string;score:number;matchedTerms:string[]})[];result?:SourceReadingResult;resultCount?:number};
export type SourceReadingSummary=Omit<SourceReadingPlan,'ranges'|'result'>&{ranges:Omit<SourceReadingPlan['ranges'][number],'text'>[]};
export const sourceHash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const MAX_BYTES = 500_000;

export function publicSourceUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw.length > 2000) throw new Error('Use a public HTTPS source URL of at most 2,000 characters.');
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && !publicAddress(host))) throw new Error('Research links must use public HTTPS; private addresses and credentials are blocked.');
  if (url.hostname === 'raw.githubusercontent.com' && url.search) throw new Error('Use a public GitHub raw source URL without query parameters.');
  url.hash = '';
  return url.href;
}

/** Fixed publisher origin uses the same zero-redirect transport as other public feeds.
 * Arbitrary destinations retain DNS validation and address pinning in safeFetch.
 * Only the URL is sent: no question, project, PDF, vault data or caller headers. */
export async function readPublicSource(raw: string, signal?: AbortSignal): Promise<PublicPage> {
  const requestedUrl = publicSourceUrl(raw), url = new URL(requestedUrl);
  const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
  bounded.throwIfAborted();
  let result: {bytes: Uint8Array; type: string; url: string};
  if (url.origin === 'https://raw.githubusercontent.com') {
    const response = await fetchWithoutRedirects(url, {credentials: 'omit', signal: bounded,
      headers: {'User-Agent': 'AnascummisStudio/0.1 (local research)', Accept: 'text/plain,text/html,application/json'}});
    if (!response.ok) {await response.body?.cancel(); throw new Error('Research source returned ' + response.status);}
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Research source has no response body.');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        bounded.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_BYTES) throw new Error('Research response too large (500,000 byte limit).');
        chunks.push(chunk.value);
      }
    } finally {await reader.cancel().catch(() => {});}
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
    result = {bytes, type: (response.headers.get('content-type') || '').split(';')[0].toLowerCase(), url: requestedUrl};
  } else result = await safeFetch(requestedUrl, MAX_BYTES, bounded);
  bounded.throwIfAborted();
  return describePublicSource(requestedUrl, result);
}

export function describePublicSource(requestedUrl: string, result: {bytes: Uint8Array; type: string; url: string}): PublicPage {
  if (!['text/html', 'text/plain', 'application/json'].includes(result.type)) throw new Error('Choose a public HTML, plain-text or JSON source.');
  if (!result.bytes.length || result.bytes.length > MAX_BYTES) throw new Error('Research response is empty or exceeds 500,000 bytes.');
  const decoded = new TextDecoder('utf-8', {fatal: true}).decode(result.bytes);
  const title = result.type === 'text/html' ? decoded.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] : decoded.match(/^#\s+(.+)$/m)?.[1];
  const text = result.type === 'text/html' ? decoded.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim() : decoded;
  if (!text.trim()) throw new Error('The source contains no readable text.');
  return {requestedUrl, url: result.url, title: (title || new URL(result.url).pathname.split('/').filter(Boolean).at(-1) || new URL(result.url).hostname).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 240),
    retrievedAt: new Date().toISOString(), type: result.type, bytes: result.bytes.length, textLength: text.length,
    sha256: sourceHash(result.bytes), textSha256: sourceHash(text), normalization: 'public-text-v1', body: result.bytes, text};
}

/** Immutable, goal-owned acquisition checkpoints. A saved acquisition survives a crash
 * before the orchestrator records its return value; explicit retry reuses it. */
export class PublicSourceLedger {
  constructor(private db: Database, private read = readPublicSource) {
    db.exec('CREATE TABLE IF NOT EXISTS goal_sources(id TEXT PRIMARY KEY,goal TEXT NOT NULL,task TEXT NOT NULL,metadata TEXT NOT NULL,body BLOB NOT NULL,text TEXT NOT NULL,UNIQUE(goal,task))');
    db.exec('CREATE TABLE IF NOT EXISTS goal_source_readings(id TEXT PRIMARY KEY,goal TEXT NOT NULL,task TEXT NOT NULL,question_hash TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(goal,task,question_hash))');
    if(!(db.query('PRAGMA table_info(goal_source_readings)').all() as {name:string}[]).some(column=>column.name==='question_hash'))db.transaction(()=>{
      db.exec('CREATE TABLE goal_source_readings_v2(id TEXT PRIMARY KEY,goal TEXT NOT NULL,task TEXT NOT NULL,question_hash TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(goal,task,question_hash))');
      for(const row of db.query('SELECT id,goal,task,body FROM goal_source_readings').all() as {id:string;goal:string;task:string;body:string}[]){const plan=JSON.parse(row.body) as SourceReadingPlan;if(sourceHash(plan.question)!==plan.questionSha256)throw new Error('An earlier saved reading has an invalid question hash.');db.query('INSERT INTO goal_source_readings_v2 VALUES(?,?,?,?,?)').run(row.id,row.goal,row.task,plan.questionSha256,row.body);}
      db.exec('DROP TABLE goal_source_readings; ALTER TABLE goal_source_readings_v2 RENAME TO goal_source_readings');
    })();
    db.exec('CREATE TABLE IF NOT EXISTS goal_source_answer_history(id TEXT PRIMARY KEY,goal TEXT NOT NULL,task TEXT NOT NULL,reading_id TEXT,attempt INTEGER NOT NULL,body TEXT NOT NULL,UNIQUE(goal,task,attempt))');
  }
  list(goalId: string): SourceSnapshot[] {
    return (this.db.query('SELECT metadata FROM goal_sources WHERE goal=? ORDER BY rowid').all(goalId) as {metadata: string}[]).map(row => JSON.parse(row.metadata));
  }
  get(goalId: string, id: string): {source: SourceSnapshot; text: string; body: Uint8Array} {
    const row = this.db.query('SELECT metadata,body,text FROM goal_sources WHERE goal=? AND id=?').get(goalId, id) as {metadata: string; body: Uint8Array; text: string} | null;
    if (!row) throw new Error('Saved source not found in this goal.');
    const source = JSON.parse(row.metadata) as SourceSnapshot;
    if (source.goalId !== goalId || source.id !== id || source.sha256 !== sourceHash(row.body) || source.textSha256 !== sourceHash(row.text)
      || source.bytes !== row.body.length || source.textLength !== row.text.length) throw new Error('Saved source identity check failed. Start a new question to acquire a fresh source.');
    return {source, text: row.text, body: row.body};
  }
  async capture(goalId: string, taskId: string, raw: string, signal: AbortSignal, progress: SourceProgress): Promise<SourceSnapshot> {
    signal.throwIfAborted();
    const url = publicSourceUrl(raw), existing = this.list(goalId).find(source => source.taskId === taskId);
    if (existing) {
      const {source} = this.get(goalId, existing.id);
      if (source.requestedUrl !== url) throw new Error('This milestone already holds a different source. Start a new question.');
      progress('source_reused', 'Reusing the saved source from ' + source.retrievedAt + '; no new public request.');
      return source;
    }
    progress('fetching_source', 'Fetching public source: ' + url);
    const page = await this.read(url, signal);
    signal.throwIfAborted();
    const {body, text, ...metadata} = page;
    const source: SourceSnapshot = {...metadata, id: crypto.randomUUID(), goalId, taskId};
    this.db.query('INSERT INTO goal_sources(id,goal,task,metadata,body,text) VALUES(?,?,?,?,?,?)').run(source.id, goalId, taskId, JSON.stringify(source), body, text);
    progress('source_saved', 'Saved ' + source.bytes + ' response bytes and full text; SHA-256 ' + source.sha256 + '.');
    return source;
  }
  page(goalId: string, id: string, offset = 0) {
    const saved = this.get(goalId, id);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > saved.text.length) throw new Error('Invalid saved-text position.');
    return {source: saved.source, offset, end: Math.min(offset + 1000, saved.text.length), text: saved.text.slice(offset, offset + 1000)};
  }
  validateRanges(goalId:string,raw:unknown):SourceRangeInput[]{
    if(!Array.isArray(raw)||!raw.length||raw.length>2)throw new Error('Choose one or two saved-text ranges.');
    let total=0;const ranges=raw.map(value=>{
      if(!value||typeof value!=='object'||typeof value.sourceId!=='string'||typeof value.textSha256!=='string'||!Number.isSafeInteger(value.start)||!Number.isSafeInteger(value.end))throw new Error('Invalid saved-text range.');
      const saved=this.get(goalId,value.sourceId);
      if(saved.source.textSha256!==value.textSha256||value.start<0||value.end<=value.start||value.end>saved.text.length||!utf16Boundary(saved.text,value.start)||!utf16Boundary(saved.text,value.end))throw new Error('Saved-text range or source identity is invalid. Use complete characters and current snapshot hashes.');
      total+=value.end-value.start;return {sourceId:value.sourceId,start:value.start,end:value.end,textSha256:value.textSha256};
    });
    if(total>1600)throw new Error('Select at most 1,600 UTF-16 text positions in total.');
    if(new Set(ranges.map(range=>range.sourceId)).size>2)throw new Error('Select at most two saved sources.');
    for(let i=0;i<ranges.length;i++)for(let j=0;j<i;j++)if(ranges[i].sourceId===ranges[j].sourceId&&ranges[i].start<ranges[j].end&&ranges[j].start<ranges[i].end)throw new Error('Selected ranges must not overlap.');
    return ranges;
  }
  reading(goalId:string,taskId='source-answer',identity?:{id?:string;questionSha256?:string},verifySources=true):SourceReadingPlan|undefined{
    const row=identity?.id?this.db.query('SELECT id,body FROM goal_source_readings WHERE goal=? AND task=? AND id=?').get(goalId,taskId,identity.id):identity?.questionSha256?this.db.query('SELECT id,body FROM goal_source_readings WHERE goal=? AND task=? AND question_hash=?').get(goalId,taskId,identity.questionSha256):this.db.query('SELECT id,body FROM goal_source_readings WHERE goal=? AND task=? ORDER BY rowid DESC LIMIT 1').get(goalId,taskId);
    if(!row)return;const saved=row as {id:string;body:string};
    const plan=JSON.parse(saved.body) as SourceReadingPlan;
    if(plan.id!==saved.id||plan.goalId!==goalId||plan.taskId!==taskId||plan.version!=='source-passages-v1'||!['auto','manual'].includes(plan.mode)||!['matched','none','manual'].includes(plan.match)||typeof plan.question!=='string'||sourceHash(plan.question)!==plan.questionSha256)throw new Error('Saved reading identity check failed. Create a new question from the saved sources.');
    if(!Array.isArray(plan.ranges)||!plan.ranges.length||plan.ranges.length>2)throw new Error('Saved reading ranges are invalid.');
    if(verifySources)this.validateRanges(goalId,plan.ranges);
    if(new Set(plan.ranges.map(range=>range.label)).size!==plan.ranges.length)throw new Error('Saved reading labels are not unique.');
    for(const range of plan.ranges){const actual=verifySources?this.get(goalId,range.sourceId).text.slice(range.start,range.end):range.text;if(typeof actual!=='string'||actual.length!==range.end-range.start||actual!==range.text||sourceHash(actual)!==range.rangeSha256)throw new Error('Saved reading range changed. Create a new question from the saved sources.');}
    return plan;
  }
  readings(goalId:string):SourceReadingPlan[]{return (this.db.query('SELECT id,task FROM goal_source_readings WHERE goal=? ORDER BY rowid').all(goalId) as {id:string;task:string}[]).map(row=>this.reading(goalId,row.task,{id:row.id})!);}
  readingPage(goalId:string,limit=10,before?:string):{readings:SourceReadingSummary[];nextCursor?:string}{
    if(!Number.isInteger(limit)||limit<1||limit>25)throw new Error('Choose a reading history limit from 1 to 25.');
    if(before!==undefined&&(!/^[1-9][0-9]*$/.test(before)||before.length>16||!Number.isSafeInteger(Number(before))))throw new Error('Invalid reading history cursor.');
    const rows=(before===undefined?this.db.query('SELECT rowid,id,task FROM goal_source_readings WHERE goal=? ORDER BY rowid DESC LIMIT ?').all(goalId,limit+1):this.db.query('SELECT rowid,id,task FROM goal_source_readings WHERE goal=? AND rowid<? ORDER BY rowid DESC LIMIT ?').all(goalId,Number(before),limit+1)) as {rowid:number;id:string;task:string}[];
    const readings=rows.slice(0,limit).map(row=>{const plan=this.reading(goalId,row.task,{id:row.id},false)!;return {...plan,ranges:plan.ranges.map(({text,...range})=>range),resultCount:this.resultCount(goalId,plan.id)};});
    return {readings,nextCursor:rows.length>limit?String(rows[limit-1].rowid):undefined};
  }
  archiveAnswer(goalId:string,task:GoalTask,question:string):SourceReadingResult|undefined{
    if(!this.db.inTransaction)throw new Error('Answer archival must share the source-question continuation transaction.');
    if(!task.sourceAnswer||!task.execution?.sourceAnswer)return;
    const prior=this.db.query('SELECT body FROM goal_source_answer_history WHERE goal=? AND task=? AND attempt=?').get(goalId,task.id,task.attempts) as {body:string}|null;if(prior)return JSON.parse(prior.body);
    const result:SourceReadingResult={id:crypto.randomUUID(),goalId,taskId:task.id,readingId:task.execution.sourceAnswer.readingId,question,attempt:task.attempts,created:Date.now(),status:task.status,execution:structuredClone(task.execution),...(task.review?{review:structuredClone(task.review)}:{})};
    this.db.query('INSERT INTO goal_source_answer_history VALUES(?,?,?,?,?,?)').run(result.id,goalId,task.id,result.readingId||null,task.attempts,JSON.stringify(result));return result;
  }
  resultCount(goalId:string,readingId:string){return (this.db.query('SELECT COUNT(*) AS count FROM goal_source_answer_history WHERE goal=? AND reading_id=?').get(goalId,readingId) as {count:number}).count;}
  readingResult(goalId:string,readingId:string):SourceReadingResult|undefined{const row=this.db.query('SELECT body FROM goal_source_answer_history WHERE goal=? AND reading_id=? ORDER BY rowid DESC LIMIT 1').get(goalId,readingId) as {body:string}|null;return row?JSON.parse(row.body):undefined;}
  prepareReading(goalId:string,taskId:string,question:string,manual?:SourceRangeInput[]):{plan:SourceReadingPlan;reused:boolean}{
    const previous=this.reading(goalId,taskId,{questionSha256:sourceHash(question)});
    if(previous){if(manual&&JSON.stringify(this.validateRanges(goalId,manual))!==JSON.stringify(previous.ranges.map(({sourceId,start,end,textSha256})=>({sourceId,start,end,textSha256}))))throw new Error('The saved reading has different text ranges. Create a new linked question to change the selection.');return {plan:previous,reused:true};}
    const sources=this.list(goalId);if(!sources.length||sources.length>2)throw new Error('One or two acquired public sources are required before selecting passages.');
    const automatic=manual?undefined:selectSourcePassages(question,sources.map(source=>({id:source.id,label:source.taskId,text:this.get(goalId,source.id).text})));
    const selected=manual?this.validateRanges(goalId,manual):automatic!.ranges.map(range=>({...range,textSha256:sources.find(source=>source.id===range.sourceId)!.textSha256}));
    const counts=new Map<string,number>();
    const ranges=selected.map(range=>{const saved=this.get(goalId,range.sourceId),number=(counts.get(range.sourceId)||0)+1;counts.set(range.sourceId,number);const automaticRange=automatic?.ranges.find(item=>item.sourceId===range.sourceId&&item.start===range.start&&item.end===range.end);const text=saved.text.slice(range.start,range.end);return {...range,label:saved.source.taskId+(number>1?'-p'+number:''),text,rangeSha256:sourceHash(text),score:automaticRange?.score||0,matchedTerms:automaticRange?.matchedTerms||[]};});
    const plan:SourceReadingPlan={id:crypto.randomUUID(),goalId,taskId,version:'source-passages-v1',mode:manual?'manual':'auto',question,questionSha256:sourceHash(question),created:Date.now(),match:manual?'manual':automatic!.match,ranges};
    this.db.transaction(()=>{this.db.query('INSERT INTO goal_source_readings(id,goal,task,question_hash,body) VALUES(?,?,?,?,?)').run(plan.id,goalId,taskId,plan.questionSha256,JSON.stringify(plan));})();
    return {plan,reused:false};
  }
  copySnapshots(parentGoalId:string,goalId:string,sourceIds:string[]):SourceSnapshot[]{
    if(!this.db.inTransaction)throw new Error('Source copies must share the new goal transaction.');
    return sourceIds.map(id=>{const saved=this.get(parentGoalId,id),source:SourceSnapshot={...saved.source,id:crypto.randomUUID(),goalId,copiedFrom:{goalId:parentGoalId,sourceId:id}};this.db.query('INSERT INTO goal_sources(id,goal,task,metadata,body,text) VALUES(?,?,?,?,?,?)').run(source.id,goalId,source.taskId,JSON.stringify(source),saved.body,saved.text);return source;});
  }
}
