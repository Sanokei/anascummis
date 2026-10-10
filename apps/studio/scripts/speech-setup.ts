import {ROOT} from '../core/storage';import {join} from 'node:path';
const python=join(ROOT,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');if(!await Bun.file(python).exists())throw new Error('Run bun run setup first');
const deps=['scipy==1.18.1','soundfile==0.14.0','pyyaml==6.0.3','pocket-tts==3.3.0'];
const args=Bun.which('uv')?['uv','pip','install','--python',python,...deps,'--index','https://download.pytorch.org/whl/cpu','--index','https://pypi.org/simple','--index-strategy','unsafe-best-match']:[python,'-m','pip','install',...deps,'--extra-index-url','https://download.pytorch.org/whl/cpu'];
const install=Bun.spawn(args,{stdout:'inherit',stderr:'inherit'});if(await install.exited)throw new Error('Speech dependency installation failed');
for(const file of ['kokoro-setup.ts','enhancer-setup.ts']){const p=Bun.spawn([process.execPath,join(ROOT,'scripts',file)],{cwd:ROOT,stdout:'inherit',stderr:'inherit'});if(await p.exited)throw new Error('Speech setup failed');}
const prepare=Bun.spawn([python,join(ROOT,'scripts','probe-pocket.py')],{cwd:ROOT,stdout:'inherit',stderr:'inherit'});if(await prepare.exited)throw new Error('Pocket voice preparation failed');
console.log('Offline Pocket TTS, Kokoro and LavaSR speech installed. Run bun scripts/probe-speech.ts to measure this CPU.');

