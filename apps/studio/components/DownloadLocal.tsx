'use client';
import {useEffect, useRef, useState} from 'react';

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
  const handledOpen=useRef<number|undefined>(undefined);
  function open(){if(dialog.current?.isConnected&&!dialog.current.open)dialog.current.showModal();}
  useEffect(()=>{if(!openRequest||handledOpen.current===openRequest||!dialog.current?.isConnected)return;handledOpen.current=openRequest;open();},[openRequest]);
  return <>
    <button className="download-local-trigger" type="button" onClick={open}>Download</button>
    <dialog ref={dialog} className="download-local-dialog" aria-labelledby="download-local-title">
      <form method="dialog"><button className="download-local-close" aria-label="Close download instructions">×</button></form>
      <h2 id="download-local-title">Anascummis on your computer</h2>
      {local && state && <LocalReadiness state={state} checking={checking} onCheck={onCheck}/>}
      <p>The local source kit includes the app, setup scripts and licenses. It requires Bun and Python, plus a first-time download of dependencies and models.</p>
      <a className="download-local-link" href="https://anascummis.com/opensource/anascummis-studio-source.zip" download="anascummis-studio-source.zip">Download local source ZIP</a>
      <p>Extract the ZIP, open a terminal in <code>studio</code>, and follow <code>LOCAL-INSTALL.md</code>:</p>
      <pre>{'bun install\nbun run setup\nbun run model:setup\nbun run speech:setup\nbun run build'}</pre>
      <p>Then run <code>bun run model:start</code> and <code>bun run start</code> in separate terminals. Open <code>http://127.0.0.1:3211</code>.</p>
      <p className="download-local-note">Windows x64 model setup installs llama.cpp automatically. macOS and Linux need a compatible llama.cpp installation and <code>LLAMA_SERVER</code>. Video tools also need FFmpeg/FFprobe. Allow several GB of disk space; device compatibility varies.</p>
    </dialog>
  </>;
}
