export type Section = { id: string; heading: string; text: string; imageId?: string };
export type SceneObject = { id: string; kind: 'box'|'sphere'|'cylinder'; color: string; x: number; y: number; z: number; size: number };
export type Site = { name: string; title: string; subtitle: string; accent: string; background: string; font: 'sans'|'serif'|'mono'; sections: Section[]; scene: SceneObject[]; paymentLink?: string };
export const initialSite = (): Site => ({ name: 'My business', title: 'Good work starts here.', subtitle: 'Tell your story, with your own words and images.', accent: '#b7ee70', background: '#17211e', font: 'sans', sections: [{id:'about',heading:'About us',text:'Introduce your business.'}], scene: [] });
export const esc = (v: string) => v.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function text(v: unknown, max = 10000): string { if(typeof v !== 'string' || v.length > max) throw new Error('Invalid text'); return v; }
export function object(v: unknown): Record<string,unknown> { if(!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected an object'); return v as Record<string,unknown>; }
export function number(v: unknown, min: number, max: number): number { if(typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`Number must be between ${min} and ${max}`); return v; }
export function color(v: unknown): string { const s=text(v,7); if(!/^#[0-9a-f]{6}$/i.test(s)) throw new Error('Use a #RRGGBB color'); return s; }
function luminance(hex:string){const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
export function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function assetId(v: unknown): string { const s=text(v,100); if(!/^[a-zA-Z0-9_-]+$/.test(s)) throw new Error('Invalid asset identifier'); return s; }
export function validateSite(input: unknown): Site {
  const s=object(input); const sections=s.sections, scene=s.scene;
  if(!Array.isArray(sections) || sections.length > 40 || !Array.isArray(scene) || scene.length > 100) throw new Error('Site exceeds its object limit');
  if(!['sans','serif','mono'].includes(s.font as string)) throw new Error('Invalid font');
  const checked: Site = {name:text(s.name,160),title:text(s.title,500),subtitle:text(s.subtitle,3000),accent:color(s.accent),background:color(s.background),font:s.font as Site['font'],
    sections:sections.map(raw=>{const a=object(raw);return {id:assetId(a.id),heading:text(a.heading,500),text:text(a.text),...(a.imageId?{imageId:assetId(a.imageId)}:{})};}),
    scene:scene.map(raw=>{const a=object(raw);if(!['box','sphere','cylinder'].includes(a.kind as string))throw new Error('Unsupported primitive');return {id:assetId(a.id),kind:a.kind as SceneObject['kind'],color:color(a.color),x:number(a.x,-100,100),y:number(a.y,-100,100),z:number(a.z,-100,100),size:number(a.size,.01,20)};})};
  if(new Set(checked.sections.map(s=>s.id)).size!==checked.sections.length || new Set(checked.scene.map(s=>s.id)).size!==checked.scene.length)throw new Error('Identifiers must be unique');
  if(s.paymentLink) { const url = new URL(text(s.paymentLink,1000)); if(url.protocol!=='https:' || url.hostname!=='buy.stripe.com' || url.username || url.password)throw new Error('Use an HTTPS Stripe Payment Link');checked.paymentLink=url.href; }
  return checked;
}
export function checkSite(site: Site, assets: string[]) {
  const errors: string[]=[];try {validateSite(site);}catch(e){errors.push(String(e));}
  for(const s of site.sections)if(s.imageId&&!assets.includes(s.imageId))errors.push(`Missing uploaded image: ${s.imageId}`);
  const publicText=JSON.stringify(site);
  if(/\b(?:sk|rk)_(?:live|test)_[a-zA-Z0-9]+|whsec_[a-zA-Z0-9]+/.test(publicText))errors.push('A private Stripe credential cannot be included in a website');
  if(!site.title.trim())errors.push('The website needs a title');
  return {ok:errors.length===0,errors,checks:['Typed content and bounded scene','Uploaded images only','No private Stripe credentials','Escaped HTML; sandboxed preview'],payment:site.paymentLink?'Hosted Stripe Payment Link; fulfillment remains in your Stripe integration':'No payment integration'};
}
export function renderSite(site: Site, imageUrl: (id:string)=>string = id=>`assets/${id}`, sceneRuntime?: string): string {
  validateSite(site);
  const font = {sans:'system-ui,sans-serif',serif:'Georgia,serif',mono:'ui-monospace,monospace'}[site.font];
  const ink=contrast('#ffffff',site.background)>=contrast('#111111',site.background)?'#ffffff':'#111111';
  const link=contrast(site.accent,site.background)>=4.5?site.accent:ink;
  const scene=site.scene.length&&sceneRuntime?`<section><h2>Explore in 3D</h2><canvas id="business-scene" aria-label="Interactive 3D scene" style="width:100%;height:450px;touch-action:none"></canvas><script type="application/json" id="scene-source">${JSON.stringify(site.scene).replace(/</g,'\\u003c')}</script><script type="module" src="${esc(sceneRuntime)}"></script></section>`:'';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(site.name)}</title><style>*{box-sizing:border-box}body{margin:0;background:${site.background};color:${ink};font:18px/1.6 ${font}}main{max-width:1100px;margin:auto;padding:40px 6vw}header{padding:10vh 0}small,a{color:${link}}h1{font-size:clamp(40px,7vw,88px);line-height:1.05;max-width:900px}h2{font-size:32px}section{padding:44px 0;border-top:1px solid ${ink}30}p{max-width:720px;white-space:pre-wrap}img{max-width:100%;max-height:560px;object-fit:contain;border-radius:16px}footer{padding:40px 0;font-size:14px}</style></head><body><main><small>${esc(site.name)}</small><header><h1>${esc(site.title)}</h1><p>${esc(site.subtitle)}</p>${site.paymentLink?`<a href="${esc(site.paymentLink)}" rel="noopener">Pay securely with Stripe</a>`:''}</header>${site.sections.map(s=>`<section id="${esc(s.id)}"><h2>${esc(s.heading)}</h2><p>${esc(s.text)}</p>${s.imageId?`<img src="${esc(imageUrl(s.imageId))}" alt="${esc(s.heading)}">`:''}</section>`).join('')}${scene}<footer>${esc(site.name)}</footer></main></body></html>`;
}
