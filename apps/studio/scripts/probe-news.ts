import {fetchNews} from '../core/news';
const start=performance.now();const pack=await fetchNews('Yemen',new AbortController().signal);console.log(JSON.stringify({ms:Math.round(performance.now()-start),...pack},null,2));
