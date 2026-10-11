'use client';
import {useRef} from 'react';

export function DownloadLocal(){
  const dialog=useRef<HTMLDialogElement>(null);
  return <>
    <button className="download-local-trigger" type="button" onClick={()=>dialog.current?.showModal()}>Download</button>
    <dialog ref={dialog} className="download-local-dialog" aria-labelledby="download-local-title">
      <form method="dialog"><button className="download-local-close" aria-label="Close download instructions">×</button></form>
      <h2 id="download-local-title">Anascummis on your computer</h2>
      <p>The local source kit includes the app, setup scripts and licenses. It requires Bun and Python, plus a first-time download of dependencies and models.</p>
      <a className="download-local-link" href="https://anascummis.com/opensource/anascummis-studio-source.zip" download="anascummis-studio-source.zip">Download local source ZIP</a>
      <p>Extract the ZIP, open a terminal in <code>studio</code>, and follow <code>LOCAL-INSTALL.md</code>:</p>
      <pre>{'bun install\nbun run setup\nbun run model:setup\nbun run speech:setup\nbun run build'}</pre>
      <p>Then run <code>bun run model:start</code> and <code>bun run start</code> in separate terminals. Open <code>http://127.0.0.1:3211</code>.</p>
      <p className="download-local-note">Windows x64 model setup installs llama.cpp automatically. macOS and Linux need a compatible llama.cpp installation and <code>LLAMA_SERVER</code>. Video tools also need FFmpeg/FFprobe. Allow several GB of disk space; device compatibility varies.</p>
    </dialog>
  </>;
}
