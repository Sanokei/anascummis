import {test,expect} from 'bun:test';
import {readSourceKitSummary} from '../core/source-kit-manifest';

const version='a'.repeat(64),valid={format:1 as const,version,filename:`anascummis-studio-${version.slice(0,16)}.zip`,sha256:'b'.repeat(64),bytes:1200,files:150,source:{commit:'c'.repeat(40),dirty:false},dependencies:{next:'16.4.3',etro:'0.14.1'}};
test('a source-kit download has an exact version, source provenance and archive checksum',()=>{
  expect(readSourceKitSummary(valid)).toEqual(valid);
  expect(readSourceKitSummary({...valid,source:{commit:null,dirty:null}}).source.commit).toBeNull();
});
test('untrusted metadata cannot direct Download outside the versioned same-origin source path',()=>{
  for(const filename of ['https://other.example/kit.zip','//other.example/kit.zip','../private.zip','anascummis-studio-source.zip',`anascummis-studio-${'d'.repeat(16)}.zip`])expect(()=>readSourceKitSummary({...valid,filename})).toThrow();
});
test('partial, malformed or unbounded metadata does not advertise a verified download',()=>{
  for(const patch of [{format:2},{version:'unknown'},{sha256:'unchecked'},{bytes:-1},{bytes:Infinity},{bytes:30*1024**2},{files:0},{source:{commit:'main',dirty:false}},{source:{commit:null,dirty:'unknown'}},{dependencies:null}])expect(()=>readSourceKitSummary({...valid,...patch})).toThrow();
  for(const value of [null,undefined,{},[],{error:'kit unavailable'}])expect(()=>readSourceKitSummary(value)).toThrow();
});
