'use client';
import {useEffect, useRef, useState} from 'react';
import {readSourceKitSummary,sourceKitManifestPath,type SourceKitSummary} from '../core/source-kit-manifest';

type RuntimeAvailability = 'checking' | 'ready' | 'unavailable' | 'unknown';
export type LocalRuntimeState = {model: RuntimeAvailability; voice: RuntimeAvailability; error?: string};
type ReadinessProps = {state: LocalRuntimeState; checking?: boolean; onCheck?: () => void | Promise<void>; onSetup?: () => void};
const modelLabels = {checking: 'Checking the local service…', ready: 'Local service reachable.', unavailable: 'Local service unavailable.', unknown: 'Not checked.'};
const voiceLabels = {checking: 'Checking initialization…', ready: 'Initialized for this page.', unavailable: 'Initialization unavailable.', unknown: 'Not checked.'};

export function LocalReadiness({state, checking = false, onCheck, onSetup}: ReadinessProps) {
  const [requested, setRequested] = useState(false), [error, setError] = useState('');
  const pending = checking || requested || state.model === 'checking';
  async function check() {
    if (!onCheck || pending) return;
    setRequested(true); setError('');
    try {await onCheck();}
    catch (failure) {setError(failure instanceof Error ? failure.message : String(failure));}
    finally {setRequested(false);}
  }
  return <div className="local-readiness" aria-label="Local runtime status" data-readiness-model={state.model} data-readiness-voice={state.voice}>
    <div role="status">
      <p><strong>AI model:</strong> {modelLabels[state.model]}</p>
      <p><strong>Voice:</strong> {voiceLabels[state.voice]}</p>
      {state.voice === 'ready' && <p className="local-readiness-note">This initialization check does not verify microphone access or spoken replies.</p>}
      {(state.error || error) && <p className="local-readiness-error">{state.error || error}</p>}
    </div>
    {(onCheck || onSetup) && <div className="local-readiness-actions">
      {onCheck && <button type="button" disabled={pending} onClick={() => void check()}>{pending ? 'Checking…' : 'Check again'}</button>}
      {onSetup && <button type="button" onClick={onSetup}>Setup instructions</button>}
    </div>}
  </div>;
}

export function DownloadLocal({local = false, openRequest, state, checking, onCheck}: {local?: boolean; openRequest?: number; state?: LocalRuntimeState; checking?: boolean; onCheck?: () => void | Promise<void>} = {}){
  const dialog=useRef<HTMLDialogElement>(null);
  const content=useRef<HTMLDivElement>(null);
  const handledOpen=useRef<number|undefined>(undefined);
  const kitControl=useRef<AbortController|undefined>(undefined);
  const [kit,setKit]=useState<SourceKitSummary>(),[kitLoading,setKitLoading]=useState(false),[kitError,setKitError]=useState('');
  async function checkSourceKit(){
    kitControl.current?.abort();const control=new AbortController();kitControl.current=control;setKit(undefined);setKitError('');setKitLoading(true);
    try{const response=await fetch(sourceKitManifestPath,{cache:'no-store',redirect:'error',signal:control.signal});if(!response.ok)throw new Error(`Source kit request failed (${response.status}).`);const value=readSourceKitSummary(await response.json());const archive=await fetch('/opensource/'+value.filename,{method:'HEAD',cache:'no-store',redirect:'error',signal:control.signal});const length=archive.headers.get('content-length');if(!archive.ok||(length!==null&&length!==String(value.bytes))||!/^application\/(?:zip|x-zip-compressed|octet-stream)(?:;|$)/i.test(archive.headers.get('content-type')||''))throw new Error('The source archive is unavailable or does not match its manifest.');if(!control.signal.aborted)setKit(value);}
    catch(error){if(!control.signal.aborted)setKitError(error instanceof Error?error.message:'The source kit could not be checked.');}
    finally{if(kitControl.current===control)setKitLoading(false);}
  }
  function open(){if(dialog.current?.isConnected&&!dialog.current.open){dialog.current.showModal();if(content.current)content.current.scrollTop=0;void checkSourceKit();}}
  useEffect(()=>()=>kitControl.current?.abort(),[]);
  useEffect(()=>{if(!openRequest||handledOpen.current===openRequest||!dialog.current?.isConnected)return;handledOpen.current=openRequest;open();},[openRequest]);
  return <>
    <button className="download-local-trigger" type="button" onClick={open}>Download</button>
    <dialog ref={dialog} className="download-local-dialog" aria-labelledby="download-local-title" onClose={()=>kitControl.current?.abort()}>
      <header className="download-local-header"><h2 id="download-local-title">Anascummis on your computer</h2><form method="dialog"><button className="download-local-close" aria-label="Close download instructions">Close</button></form></header>
      <div ref={content} className="download-local-content">
      <section className="download-source-kit" aria-label="Local source kit">
        {kitLoading?<p role="status">Checking this app's source kit…</p>:kit?<>
          <p><strong>Source kit <code>{kit.version.slice(0,16)}</code></strong> · {(kit.bytes/1024**2).toFixed(2)} MiB</p>
          {kit.source.commit&&<p>{kit.source.dirty?'Working copy based on':'Source'} <code>{kit.source.commit.slice(0,12)}</code></p>}
          <p>Source to install, not a desktop executable. Dependencies and model weights are not included.</p>
          <a className="download-local-link" href={'/opensource/'+kit.filename} download={kit.filename}>Download local source ZIP</a>
          <details><summary>Verify this download</summary><p>ZIP SHA-256</p><code className="source-kit-checksum">{kit.sha256}</code><p>The ZIP includes <code>studio/SOURCE-KIT.json</code> with every source file's hash. Keep the licenses and <code>bun.lock</code>.</p></details>
        </>:<>
          <p role="alert">A verified source kit is unavailable from this copy of the app. {kitError}</p>
          <p>Ask the person who supplied this copy for its current source kit. If you have the source, <code>bun run build</code> also prepares its download.</p>
          <button type="button" onClick={()=>void checkSourceKit()}>Check source kit again</button>
        </>}
      </section>
      {local && state && <LocalReadiness state={state} checking={checking} onCheck={onCheck}/>}
      <p>The kit includes this app, setup scripts, lockfile and licenses. Installed runtimes and private data are excluded.</p>
      <p>Install Bun, Node 20.9 or newer and Python first. Extract the ZIP, open a terminal in <code>studio</code>, and follow <code>LOCAL-INSTALL.md</code>:</p>
      <pre>{'bun install --frozen-lockfile\nbun run setup\nbun run build\nbun run start'}</pre>
      <p>Open <code>http://127.0.0.1:3211</code>. The app can open before AI/voice setup and will show unavailable services. To enable them, follow the guide's <code>model:setup</code> and <code>speech:setup</code> steps, then keep <code>bun run model:start</code> and <code>bun run start</code> in separate terminals. Failed or blocked downloads do not mean setup succeeded.</p>
      <p className="download-local-note">Setup requires connectivity and several GB of free disk space. Windows x64 model setup obtains the official CPU llama.cpp runtime; macOS/Linux need a compatible runtime and <code>LLAMA_SERVER</code>. Optional video tools need FFmpeg/FFprobe. Device and native voice compatibility remain unverified here.</p>
      </div>
    </dialog>
  </>;
}
