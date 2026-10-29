from pathlib import Path,PurePosixPath
import sys,json,hashlib,zipfile,stat
archive=Path(sys.argv[1]);summary=json.loads(Path(sys.argv[2]).read_text());target=Path(sys.argv[3]);repo=Path('/workspace/anascummis');studio=repo/'apps/studio'
sha=lambda b:hashlib.sha256(b).hexdigest()
assert archive.stat().st_size==summary['bytes'];assert sha(archive.read_bytes())==summary['sha256']
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 names=z.namelist();assert len(names)==len(set(names))
 for name in names:
  parts=PurePosixPath(name).parts;assert not name.startswith('/') and '..' not in parts and '\\' not in name
  assert name=='README.txt' or name.startswith(('studio/','dependencies/etro/'))
  assert not stat.S_ISLNK(z.getinfo(name).external_attr>>16)
  assert not any(part in ['.git','.data','.runtime','.venv','.next','out','node_modules','__pycache__','cache','credentials','secrets'] for part in parts)
  assert not name.endswith(('.pyc','.sqlite','.sqlite-wal','.sqlite-shm','.db','.key','.pem','.gguf','.onnx','.safetensors','.bin','.part'))
  assert not any(part.startswith('.env') for part in parts) or name=='studio/.env.example'
 inside=json.loads(z.read('studio/SOURCE-KIT.json'));assert inside['version']==summary['version'];assert inside['source']==summary['source'];assert len(inside['files'])==summary['files'];assert set(names)=={f['path'] for f in inside['files']}|{'studio/SOURCE-KIT.json'}
 for f in inside['files']:
  b=z.read(f['path']);assert len(b)==f['bytes'] and sha(b)==f['sha256']
 payload={key:inside[key] for key in ['format','source','dependencies','files']};assert sha((json.dumps(payload,ensure_ascii=False,indent=2)+'\n').encode())==inside['version']
 required=['studio/bun.lock','studio/package.json','studio/LOCAL-INSTALL.md','studio/core/goal-orchestrator.ts','studio/components/WorkPanel.tsx','studio/components/DownloadLocal.tsx','studio/app/page.tsx','studio/app/style.css','studio/shared/types.ts','studio/worker/pdf_worker.py','studio/worker/lavasr/LICENSE','studio/licenses/etro-GPL-3.0.txt','studio/licenses/VOICE.md','dependencies/etro/LICENSE','dependencies/etro/package.json']
 for name in required:assert name in names,name
 pkg=json.loads(z.read('studio/package.json'));assert pkg['dependencies']['next']=='16.4.3';assert pkg['overrides']['sharp']=='0.35.5';assert pkg['scripts']['kit:build']=='bun scripts/publish-sources.ts';assert json.loads(z.read('studio/tsconfig.json'))['compilerOptions']['paths']['@shared/types']==['./shared/types.ts']
 assert z.read('studio/bun.lock')==(studio/'bun.lock').read_bytes()
 compared={}
 for name in ['app/page.tsx','app/style.css','components/DownloadLocal.tsx','components/WorkPanel.tsx','core/goal-orchestrator.ts','core/source-kit-manifest.ts','scripts/publish-sources.ts','LOCAL-INSTALL.md']:
  compared[name]=sha(z.read('studio/'+name));assert z.read('studio/'+name)==(studio/name).read_bytes()
 assert z.read('studio/shared/types.ts')==(repo/'src/shared/types.ts').read_bytes()
 assert z.read('dependencies/etro/LICENSE')==(studio/'node_modules/etro/LICENSE').read_bytes()
 target.mkdir(parents=True,exist_ok=False);z.extractall(target)
result={'archive':archive.name,'version':summary['version'],'zipSha256':summary['sha256'],'payloadFiles':summary['files'],'source':inside['source'],'crcAndAllPayloadHashesPassed':True,'privacyExclusionsPassed':True,'requiredLockfilesLicensesAndSourcePassed':True,'standaloneAliasPassed':True,'currentSourceHashes':compared,'extractRoot':str(target/'studio'),'dependencyReuse':'The next stage links the already installed matching node_modules and uses the existing Python environment; no clean online install is claimed.'}
(target/'audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
