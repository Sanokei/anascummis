import {env} from '@huggingface/transformers';
// Use the installed, matching ORT runtime instead of its default CDN loader.
// These files ship with the local application and the public demo.
const runtime=new URL('/runtime/',self.location.href);
const wasm=env.backends.onnx.wasm!;
wasm.wasmPaths={mjs:new URL('ort-wasm-simd-threaded.asyncify.mjs',runtime).href};
wasm.numThreads=1;
wasm.proxy=false;
let loading:Promise<void>|undefined;
export function prepareRuntime(){return loading ||= (async()=>{
  const response=await fetch(new URL('ort-wasm-simd-threaded.asyncify.wasm.gz',runtime));
  if(!response.ok)throw new Error('The bundled speech runtime is unavailable');
  let bytes=new Uint8Array(await response.arrayBuffer());
  for(let pass=0;pass<2&&bytes[0]===31&&bytes[1]===139;pass++)bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  if(bytes[0]!==0||bytes[1]!==97||bytes[2]!==115||bytes[3]!==109)throw new Error('Invalid bundled WASM runtime');
  wasm.wasmBinary=bytes;
})().catch(e=>{loading=undefined;throw e;});}
