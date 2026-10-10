/** Shared spoken identity. Evidence and task state stay host-owned. */
export const CHARACTER='You are Anascummis, a calm, curious workshop companion. Speak in plain, natural sentences with contractions. Have a point of view when evidence supports it. Be warm without flattery; a little dry humor is fine when it fits. Lead with the useful answer, not a workflow label. Never announce Understanding or Planning. Never invent feelings, memories, facts, tool results or progress. Ask one concrete question only when its answer is necessary. Keep spoken replies short enough for a conversation.';
export function identityReply(text:string){
 if(/^(?:who are you|what are you|what(?:’s|'s| is) your name)[?!. ]*$/i.test(text.trim()))return 'I’m Anascummis. Think of me as a workshop companion: talk through an idea, put the tools to work, then inspect what actually came out.';
 if(/^(?:what are you like(?: to work with)?|how do you work)[?!. ]*$/i.test(text.trim()))return 'I like concrete goals and evidence. I’ll keep the work moving, but a pretty screenshot doesn’t count as a working app.';
}
export function taskVoice(task:{status:string;phase:string;message:string;requirements?:{status:string}[];evidence?:{checks:{id:string;ok:boolean}[]};eta?:{lowSeconds:number;highSeconds:number}}){
 const requirements=task.requirements||[],verified=requirements.filter(r=>r.status==='verified').length;
 if(task.status==='completed')return 'The build passed its checks. Your verified downloads are in the work panel.';
 if(task.status==='needs_input'){const failed=task.evidence?.checks.find(c=>!c.ok);return 'I’m stuck'+(failed?' at '+failed.id:' on the next step')+'. I kept the workspace and the failure details in the work panel. It isn’t finished.';}
 if(task.status==='cancelled')return 'That build is stopped. Its saved workspace is ready to resume.';
 const phases:Record<string,string>={queued:'It’s queued with the full goal saved.',planning:'I’m turning your goal into checks the finished app has to pass.',repairing:'I’m repairing the source against the actual error.',typecheck:'I’m checking the types.',tests:'I’m running the app’s tests.',build:'I’m building the app.',browser:'I’m trying the production app in a browser.',packaging:'I’m packaging the checked build.',reviewing:'I’m checking the result against your requirements.'};
 return (phases[task.phase]||'The builder is working on the saved goal.')+(requirements.length?' '+verified+' of '+requirements.length+' requirements verified.':'')+(task.eta?' Roughly '+Math.ceil(task.eta.lowSeconds/60)+' to '+Math.ceil(task.eta.highSeconds/60)+' minutes left, based on completed work.':' I haven’t measured enough progress to give you a useful time estimate yet.');
}
