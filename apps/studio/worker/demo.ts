import {fetchVisual} from '../core/visual-context';
import {fetchNews} from '../core/news';
export {PeerRoom} from './peer-room';
export {GoalDirectory} from './goal-directory';
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(url.pathname==='/api/goals'){const origin=request.headers.get('Origin');if(request.method==='OPTIONS'&&(origin===url.origin||origin==='http://127.0.0.1:3211'))return new Response(null,{headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, DELETE','Access-Control-Allow-Headers':'Content-Type, X-Requested-With','Access-Control-Max-Age':'600'}});if(request.method!=='GET'&&((origin!==url.origin&&origin!=='http://127.0.0.1:3211')||request.headers.get('X-Requested-With')!=='Anascummis'))return new Response('Unapproved origin',{status:403});const response=await env.GOAL_DIRECTORY.getByName('public-v1').fetch(request);const headers=new Headers(response.headers);if(origin==='http://127.0.0.1:3211'){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}return new Response(response.body,{status:response.status,headers});}
    const peer=/^\/api\/peers\/([a-f0-9]{32})$/.exec(url.pathname);
    if(peer){const origin=request.headers.get('Origin');if(origin!==url.origin&&origin!=='http://127.0.0.1:3211')return new Response('Unapproved origin',{status:403});return env.PEER_ROOMS.getByName(peer[1]).fetch(request);}
    if(url.pathname==='/api/news'||url.pathname==='/api/visual'){
      if(request.method!=='POST')return Response.json({error:'Use POST'},{status:405});
      if(request.headers.get('Origin')!==url.origin||request.headers.get('X-Requested-With')!=='Anascummis')return Response.json({error:'Same-origin requests only'},{status:403});
      const length=Number(request.headers.get('Content-Length')||0);if(length>2000)return new Response('Request too large',{status:413});
      try{const raw=await request.text();if(raw.length>2000)return new Response('Request too large',{status:413});const body=JSON.parse(raw);if(typeof body.query!=='string'||body.query.length>500)throw new Error('Ask a short news question');return Response.json(await (url.pathname==='/api/visual'?fetchVisual(body.query,request.signal):fetchNews(body.query,request.signal)),{headers:{'Cache-Control':'no-store'}});}catch(e){return Response.json({error:e instanceof Error?e.message:'News lookup failed'},{status:502});}
    }
    return env.ASSETS.fetch(request);
  }
};


