import {streamAnswer} from '../core/model';
import {fetchNews} from '../core/news';
import {replyPrompt} from '../core/conversation';
import {fetchVisual} from '../core/visual-context';
const rows=[];
for(const question of ['Why is the sky blue?','What is the current situation in Yemen like?']){
 const start=performance.now();const news=question.includes('Yemen')?await fetchNews(question,new AbortController().signal):undefined;const retrieved=performance.now();const prompt=replyPrompt(question,[],news);let first=0,full='';
 for await(const delta of streamAnswer(prompt.system,prompt.user,AbortSignal.timeout(45000))){if(!first)first=performance.now();full+=delta;}
 rows.push({question,retrievalMs:Math.round(retrieved-start),firstTextMs:Math.round(first-start),totalTextMs:Math.round(performance.now()-start),answer:full,sourceCount:news?.results.length});
}
const visualStart=performance.now();let visual;try{visual=await fetchVisual('What is the current situation in Yemen like?',AbortSignal.timeout(20000));}catch(e){visual={error:String(e)};}
console.log(JSON.stringify({runtime:'native Qwen3-0.6B Q4_0 CPU, 4 threads, warm weights; no TTS included',rows,visualMs:Math.round(performance.now()-visualStart),visual},null,2));
