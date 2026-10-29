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
export function compileNumericScreen(raw:unknown){validate(numericScreenSchema,raw);const spec=raw as NumericScreen;if(!spec.outputLabel.trim()||!spec.buttonLabel.trim()||spec.resetButtonLabel!==undefined&&(!spec.resetButtonLabel.trim()||spec.resetButtonLabel===spec.buttonLabel))throw new Error('Controls need distinct accessible labels');return "'use client';\nimport {useState} from 'react';\nconst spec="+JSON.stringify(spec)+";\nexport default function Page(){const [value,setValue]=useState(spec.initial);return <main><h1>{spec.title}</h1><output aria-label={spec.outputLabel}>{value}</output><button onClick={()=>setValue(previous=>previous+spec.delta)}>{spec.buttonLabel}</button>"+(spec.resetButtonLabel?"<button onClick={()=>setValue(spec.initial)}>{spec.resetButtonLabel}</button>":'')+"</main>;}\n";}
