import {DurableObject} from 'cloudflare:workers';
import {verifyPeer,parseInvite,digest} from '../core/peers';
type Listing={room:string;goal:string;invite:string;owner:string;expires:number};
export class GoalDirectory extends DurableObject<Env>{
 async fetch(request:Request){const now=Date.now(),list=(await this.ctx.storage.get<Listing[]>('goals')||[]).filter(goal=>goal.expires>now);
  if(request.method==='GET')return Response.json({goals:list.map(({room,goal,invite,expires})=>({room,goal,invite,expires}))},{headers:{'Cache-Control':'no-store'}});
  if(Number(request.headers.get('Content-Length')||0)>5000)return new Response('Too large',{status:413});const raw=await request.text();if(raw.length>5000)return new Response('Too large',{status:413});
  try{const body=JSON.parse(raw),message=await verifyPeer(body.message),invite=parseInvite(body.invite);if(message.kind!==(request.method==='POST'?'publish':'unpublish')||message.text.length>1000||await digest(message.text)!==message.goal)throw new Error('Invalid goal');if(message.room!==invite.room||message.inviteDigest!==await digest(body.invite))throw new Error('Publication signature does not cover this invite');const owner=await this.env.PEER_ROOMS.getByName(invite.room).owner();if(owner!==message.sender)throw new Error('Only the room creator can list its goal');
   const next=list.filter(goal=>goal.room!==invite.room);if(request.method==='POST'){if(next.length>=100)throw new Error('Directory full; try later');next.push({room:invite.room,goal:message.text,invite:body.invite,owner,expires:now+86400000});}else if(request.method!=='DELETE')return new Response('Unsupported method',{status:405});await this.ctx.storage.put('goals',next);await this.ctx.storage.setAlarm(now+86400000);return Response.json({ok:true});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'Invalid listing'},{status:400});}
 }
 async alarm(){const now=Date.now(),list=(await this.ctx.storage.get<Listing[]>('goals')||[]).filter(goal=>goal.expires>now);await this.ctx.storage.put('goals',list);if(list.length)await this.ctx.storage.setAlarm(Math.min(...list.map(goal=>goal.expires)));}
}


