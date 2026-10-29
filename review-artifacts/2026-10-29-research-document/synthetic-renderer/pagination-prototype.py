from pathlib import Path
import pymupdf as fitz,html,json,hashlib
base=Path('/workspace/.cloud-env/anascummis/research-document/research')
url='https://example.org/'+'evidence'*34+'/article'
sha='da2572f16c06133561ce56accaa822216f2391ef4d37fba427801cd6736417d4'
paragraph='Accepted cited answer. Notes and citations remain exact. A long bounded paragraph tests deliberate pagination and readable type.'
variants={
 'plain':(url,sha,''),
 'css-anywhere':(url,sha,'overflow-wrap:anywhere;word-break:break-all;'),
 'wbr':('<wbr>'.join(html.escape(url)[i:i+12] for i in range(0,len(url),12)),'<wbr>'.join(sha[i:i+12] for i in range(0,len(sha),12)),''),
 'spacechunks':(' '.join(url[i:i+12] for i in range(0,len(url),12)),' '.join(sha[i:i+12] for i in range(0,len(sha),12)),'')
}
results=[]
for name,(u,s,style) in variants.items():
 body='<h1>Research brief pagination proof</h1>'+''.join('<p>'+html.escape(paragraph)+'</p>' for _ in range(25))+'<h2>Source identity</h2><p>'+u+'</p><p>'+s+'</p><p>FINAL-END-MARKER-928</p>'
 story=fitz.Story(body,user_css='body {font-family:sans-serif;font-size:11pt;line-height:1.4;} p{'+style+'}')
 calls=[]
 def rectfn(num,filled):
  if num>20: raise ValueError('Too many pages')
  calls.append(num)
  return fitz.Rect(0,0,595,842),fitz.Rect(48,48,547,794),None
 doc=story.write_with_links(rectfn)
 p=base/('pagination-'+name+'.pdf');doc.save(p)
 txt='\n'.join(page.get_text() for page in doc)
 boxes=[]
 for i,page in enumerate(doc):
  for b in page.get_text('dict')['blocks']:
   for line in b.get('lines',[]):
    for sp in line.get('spans',[]):
     if sp['bbox'][2]>548 or sp['bbox'][0]<47 or sp['bbox'][3]>795:boxes.append({'page':i+1,'text':sp['text'],'bbox':sp['bbox']})
 normalize=lambda x:''.join(x.split())
 result={'variant':name,'pages':len(doc),'urlCompleteIgnoringWhitespace':normalize(url) in normalize(txt),'hashCompleteIgnoringWhitespace':sha in normalize(txt),'paragraphOccurrences':txt.count(paragraph[:26]),'endMarkerPresent':'FINAL-END-MARKER-928' in txt,'outOfBoundsSpans':boxes,'pdfBytes':p.stat().st_size,'pdfSha256':hashlib.sha256(p.read_bytes()).hexdigest()}
 results.append(result)
 (base/('pagination-'+name+'.txt')).write_text(txt)
 doc.close()
(base/'pagination-prototype.json').write_text(json.dumps({'scope':'Synthetic local rendering proof, not native-generated document or product acceptance','pymupdfVersion':fitz.VersionBind,'longUrl':url,'sourceHash':sha,'results':results},indent=2)+'\n')
print(json.dumps(results,indent=2))
