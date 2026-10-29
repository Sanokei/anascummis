import {objectSchema,validate} from './harness';
/** Bounded UI skill: the model specifies behavior; the compiler owns React syntax.
 * It cannot fetch data, claim arbitrary app support, or execute model strings. */
export const numericScreenSchema=objectSchema({title:{type:'string',maxLength:80},outputLabel:{type:'string',maxLength:60},buttonLabel:{type:'string',maxLength:60},initial:{type:'number',minimum:-1000000,maximum:1000000},delta:{type:'number',minimum:-1000000,maximum:1000000},resetButtonLabel:{type:'string',maxLength:60}},['title','outputLabel','buttonLabel','initial','delta']);
export type NumericScreen={title:string;outputLabel:string;buttonLabel:string;initial:number;delta:number;resetButtonLabel?:string};
export type CounterSkillSpec={heading?:string;resetButton?:'Reset'};
export type CounterSkillBrowserContract={kind:'counter';label:'Count';button:'Increment';heading?:string;resetButton?:'Reset'};
/** Only this closed, bounded request class has a complete host acceptance contract.
 * Extra requirements must remain with the general worker, never silently disappear. */
export function counterSkillSpec(goal:string):CounterSkillSpec|undefined{
 if(typeof goal!=='string'||goal.length>700||!/\b(?:create|build|make)\b/i.test(goal))return;
 let rest=goal,heading:string|undefined;
 const headings=[...rest.matchAll(/\b(?:heading|title)\s+(?:(?:of|as|to|called|named)\s+)?(?:"([^"\r\n]+)"|“([^”\r\n]+)”|'([^'\r\n]+)'|([^,.;!?\r\n]+))/gi)];
 if(headings.length>1)return;
 if(headings.length){const match=headings[0];heading=(match[1]??match[2]??match[3]??match[4]).trim();if(!heading||heading.length>80)return;rest=rest.slice(0,match.index)+' '+rest.slice(match.index!+match[0].length);}
 rest=rest.replace(/\b(?:include|run|add)(?:\s+the)?\s+browser\s+(?:checks|tests)\b/gi,' ').replace(/\b(?:give\s+me|provide|include|export|return|deliver)(?:\s+(?:a|the))?\s+source\s+zip(?:\s+(?:file|archive))?\b/gi,' ');
 if(/\b(?:zero|0|one|1)\s+(?:and|or)\s+(?:zero|0|one|1)\b/i.test(rest))return;
 const resets=[...rest.matchAll(/\b(?:a|the)?\s*reset\s+button\s+(?:that\s+)?(?:returns?|resets?)\s+(?:(?:the\s+)?(?:count|counter|value)\s+)?to\s+(?:zero|0)\b/gi)];
 if(resets.length>1)return;
 if(resets.length){const match=resets[0];rest=rest.slice(0,match.index)+' '+rest.slice(match.index!+match[0].length);}
 if(/\breset\b/i.test(rest)||/[^a-z0-9\s.,;!?"'():\-]/i.test(rest))return;
 const words=rest.toLowerCase().match(/[a-z0-9]+/g)||[],allowed=new Set('create build make a an bun nextjs next js react simple small app application program with counter show the count starts start starting at from zero 0 and increment button that increases increase adds add one 1 test it tests testing to by each click press pressing on is initial value initially'.split(' '));
 if(!words.every(word=>allowed.has(word))||!/\bcounter\b/i.test(rest)||!/\bincrement\b/i.test(rest)||!/\b(?:starts?|starting|initial(?:ly)?(?:\s+value)?)(?:\s+(?:is|at|of|from))?\s+(?:zero|0)\b/i.test(rest))return;
 if(/\b(?:starts?|starting|initial(?:ly)?(?:\s+value)?)(?:\s+(?:is|at|of|from))?\s+(?:one|1)\b/i.test(rest)||/\b(?:adds?|increases?|increments?)\s+(?:(?:the\s+)?(?:count|counter|value)\s+)?(?:by\s+)?(?:zero|0)\b/i.test(rest)||/\bincrement\s+button\s+(?:by\s+)?(?:zero|0)\b/i.test(rest))return;
 return {...(heading?{heading}:{}),...(resets.length?{resetButton:'Reset' as const}:{})};
}
export function counterSkillGoal(goal:string){return counterSkillSpec(goal)!==undefined;}
export function counterSkillBrowserContract(goal:string):CounterSkillBrowserContract|undefined{const spec=counterSkillSpec(goal);return spec?{kind:'counter',label:'Count',button:'Increment',...spec}:undefined;}
/** Literal user fields constrain the host compiler; they do not become executable strings. */
export function groundNumericScreen(goal:string,raw:unknown):NumericScreen{
 validate(numericScreenSchema,raw);const value=raw as NumericScreen,spec=counterSkillSpec(goal);
 if(!spec)return value;
 return {title:spec.heading??value.title,outputLabel:'Count',buttonLabel:'Increment',initial:0,delta:1,...(spec.resetButton?{resetButtonLabel:spec.resetButton}:{})};
}
export function counterSkillEvidenceMatches(goal:string,contract:unknown){
 const expected=counterSkillBrowserContract(goal),actual=contract as {kind?:string;label?:string;button?:string;initial?:number;delta?:number;heading?:string;resetButton?:string}|null;
 return !!expected&&!!actual&&actual.kind==='counter'&&actual.label===expected.label&&actual.button===expected.button&&(actual.initial??0)===0&&(actual.delta??1)===1&&actual.resetButton===expected.resetButton&&(expected.heading===undefined||actual.heading===expected.heading);
}
export function compileNumericScreen(raw:unknown){
 validate(numericScreenSchema,raw);const spec=raw as NumericScreen;
 if(!spec.outputLabel.trim()||!spec.buttonLabel.trim()||spec.resetButtonLabel!==undefined&&(!spec.resetButtonLabel.trim()||spec.resetButtonLabel===spec.buttonLabel))throw new Error('Controls need distinct accessible labels');
 const styles=`
body{margin:0;background:#f4f6f3}
.numeric-screen,.numeric-screen *{box-sizing:border-box}
.numeric-screen{min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:48px 24px;color:#17392b;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light}
.numeric-screen .counter-card{width:min(100%,560px);min-width:0;padding:40px;background:#fff;border:1px solid #d8e1d9;border-radius:24px;box-shadow:0 12px 40px #1d402b0a}
.numeric-screen h1{margin:0;font-size:clamp(1.75rem,4vw,2.5rem);font-weight:700;line-height:1.15;letter-spacing:-.035em;overflow-wrap:anywhere}
.numeric-screen .counter-intro{margin:12px 0 0;color:#53665a;font-size:1rem;line-height:1.6;overflow-wrap:anywhere}
.numeric-screen .counter-reading{margin:32px 0 24px;padding:28px 20px;background:#edf4ef;border:1px solid #d4e2d9;border-radius:16px;text-align:center}
.numeric-screen .counter-reading label{display:block;font-size:1.125rem;font-weight:650;line-height:1.4;overflow-wrap:anywhere}
.numeric-screen output{display:block;margin-top:8px;font-size:clamp(2.5rem,12vw,5.75rem);font-weight:650;font-variant-numeric:tabular-nums;line-height:1.1;letter-spacing:-.04em;overflow-wrap:anywhere}
.numeric-screen .counter-actions{display:flex;flex-wrap:wrap;gap:12px}
.numeric-screen button{flex:1 1 120px;min-width:44px;min-height:52px;max-width:100%;padding:13px 20px;border:1px solid #174d3b;border-radius:12px;background:#174d3b;color:#fff;font:inherit;font-weight:650;line-height:1.4;overflow-wrap:anywhere;cursor:pointer;touch-action:manipulation}
.numeric-screen button:hover{background:#103e2e}
.numeric-screen button+button{border-color:#b8c8bd;background:#fff;color:#244a37}
.numeric-screen button+button:hover{background:#f1f5f1}
.numeric-screen button:focus-visible{outline:3px solid #81551a;outline-offset:4px}
.numeric-screen .counter-feedback{min-height:1.5em;margin:18px 0 0;color:#274a3a;font-size:.9375rem;line-height:1.5;overflow-wrap:anywhere}
.numeric-screen .counter-note{margin:24px 0 0;padding-top:20px;border-top:1px solid #e1e6e1;color:#59665c;font-size:.875rem;line-height:1.55;overflow-wrap:anywhere}
@media(max-width:480px){.numeric-screen{place-items:start center;padding:24px 16px}.numeric-screen .counter-card{padding:24px;border-radius:20px}.numeric-screen .counter-reading{margin-top:24px;padding:24px 16px}}
@media(max-width:380px){.numeric-screen .counter-actions{flex-direction:column}.numeric-screen button{flex-basis:auto}}
@media(forced-colors:active){.numeric-screen button:focus-visible{outline-color:Highlight}}
`;
 return `'use client';
import {useState} from 'react';
const spec=${JSON.stringify(spec)};
const styles=${JSON.stringify(styles)};
export default function Page(){
 const [value,setValue]=useState(spec.initial);
 const [activity,setActivity]=useState({label:'',sequence:0});
 function increment(){setValue(previous=>previous+spec.delta);setActivity(previous=>({label:spec.buttonLabel,sequence:previous.sequence+1}));}
 ${spec.resetButtonLabel?"function reset(){setValue(spec.initial);setActivity(previous=>({label:spec.resetButtonLabel,sequence:previous.sequence+1}));}":''}
 return <main className="numeric-screen"><style>{styles}</style><section className="counter-card">
  <h1>{spec.title}</h1>
  <p className="counter-intro">{spec.buttonLabel} adds {spec.delta} each time.</p>
  <div className="counter-reading"><label htmlFor="counter-value">{spec.outputLabel}</label><output id="counter-value" aria-label={spec.outputLabel} aria-live="off">{value}</output></div>
  <div className="counter-actions"><button type="button" onClick={increment}>{spec.buttonLabel}</button>${spec.resetButtonLabel?'<button type="button" onClick={reset}>{spec.resetButtonLabel}</button>':''}</div>
  <p className="counter-feedback" role="status" aria-live="polite" aria-atomic="true"><span key={activity.sequence}>{activity.label?activity.label+': '+spec.outputLabel+' is '+value+'.':'Ready when you are.'}</span></p>
  <p className="counter-note">Reloading starts again at {spec.initial}.</p>
 </section></main>;
}
`;
}
