export const sourceKitManifestPath='/opensource/manifest.json';
export type SourceKitSummary={format:1;version:string;filename:string;sha256:string;bytes:number;files:number;source:{commit:string|null;dirty:boolean|null};dependencies:{next:string;etro:string}};
/** Download links only refer to the versioned artifact on this application's own origin. */
export function readSourceKitSummary(raw:unknown):SourceKitSummary{
  const value=raw as SourceKitSummary;
  if(!value||value.format!==1||!/^([a-f0-9]{64})$/.test(value.version)||value.filename!==`anascummis-studio-${value.version.slice(0,16)}.zip`||!/^([a-f0-9]{64})$/.test(value.sha256)||!Number.isSafeInteger(value.bytes)||value.bytes<=0||value.bytes>25*1024**2||!Number.isSafeInteger(value.files)||value.files<1||!value.source||(value.source.commit!==null&&!/^[a-f0-9]{40}$/.test(value.source.commit))||![true,false,null].includes(value.source.dirty)||!value.dependencies||typeof value.dependencies.next!=='string'||typeof value.dependencies.etro!=='string')throw new Error('This app did not supply a valid source-kit manifest.');
  return {format:1,version:value.version,filename:value.filename,sha256:value.sha256,bytes:value.bytes,files:value.files,source:{commit:value.source.commit,dirty:value.source.dirty},dependencies:{next:value.dependencies.next,etro:value.dependencies.etro}};
}
