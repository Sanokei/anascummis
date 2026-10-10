const origin='http://127.0.0.1:3211';const landing=await fetch(origin),cookie=landing.headers.get('set-cookie')?.split(';')[0]||'';
const start=performance.now();const response=await fetch(origin+'/api/answer-stream',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-Requested-With':'Anascummis','Content-Type':'application/json'},body:JSON.stringify({text:'What is the current situation in Yemen like?',history:[],news:true})});console.log(response.status,Math.round(performance.now()-start));console.log((await response.text()).slice(0,1500));
export {};
