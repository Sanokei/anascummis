import {join} from 'node:path';
import {mkdir} from 'node:fs/promises';
const root=join(import.meta.dir,'..'),built=await Bun.build({entrypoints:[join(root,'components','scene-runtime.ts')],outdir:join(root,'public'),naming:'scene.js',target:'browser',minify:true});
if(!built.success)throw new Error(built.logs.join('\n'));

const runtimeDir = join(import.meta.dir, '..', 'public', 'runtime');
await mkdir(runtimeDir, {recursive:true});
const runtimeSource=join(import.meta.dir,'..','node_modules','onnxruntime-web','dist');
await Bun.write(join(runtimeDir,'ort-wasm-simd-threaded.asyncify.mjs'),Bun.file(join(runtimeSource,'ort-wasm-simd-threaded.asyncify.mjs')));
await Bun.write(join(runtimeDir,'ort-wasm-simd-threaded.asyncify.wasm.gz'),Bun.gzipSync(new Uint8Array(await Bun.file(join(runtimeSource,'ort-wasm-simd-threaded.asyncify.wasm')).arrayBuffer())));
