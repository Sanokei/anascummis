import {PeerIdentity,newInvite,digest,sealPeer,openPeer} from '../core/peers';
const base=process.env.PEER_PROBE_URL||'http://127.0.0.1:8787',origin=new URL(base).origin,invite=newInvite(),alice=await PeerIdentity.create(),bob=await PeerIdentity.create(),goal=await digest('Synthetic test: create a garden website');
const opened=(identity:PeerIdentity)=>new Promise<WebSocket>((resolve,reject)=>{const socket=new (WebSocket as any)(base.replace(/^http/,'ws')+'/api/peers/'+invite.room+'?sender='+identity.id,{headers:{Origin:origin}});socket.onopen=()=>resolve(socket);socket.onerror=()=>reject(new Error('Relay unavailable'));});
const a=await opened(alice),b=await opened(bob);let received=false;b.onmessage=event=>{void openPeer(String(event.data),invite.key).then(value=>{if(value.kind==='task'&&value.to===bob.id)received=true;});};
a.send(await sealPeer(await alice.message(goal,'task','Propose two sections',{to:bob.id}),invite.key));
await new Promise(resolve=>setTimeout(resolve,300));if(!received)throw new Error('Peer task was not delivered');
const url='https://anascummis.com/#goal='+invite.room+'.'+invite.key,headers={Origin:origin,'Content-Type':'application/json','X-Requested-With':'Anascummis'};
const post=await fetch(base+'/api/goals',{method:'POST',headers,body:JSON.stringify({message:await alice.message(goal,'publish','Synthetic test: create a garden website',{room:invite.room,inviteDigest:await digest(url)}),invite:url})});if(!post.ok)throw new Error('Directory publication failed: '+await post.text());
const directory=await (await fetch(base+'/api/goals')).json() as any;if(!directory.goals.some((g:any)=>g.room===invite.room))throw new Error('Published goal missing');
const forged=await fetch(base+'/api/goals',{method:'DELETE',headers,body:JSON.stringify({message:await bob.message(goal,'unpublish','Synthetic test: create a garden website',{room:invite.room,inviteDigest:await digest(url)}),invite:url})});if(forged.ok)throw new Error('Non-owner changed directory');
const remove=await fetch(base+'/api/goals',{method:'DELETE',headers,body:JSON.stringify({message:await alice.message(goal,'unpublish','Synthetic test: create a garden website',{room:invite.room,inviteDigest:await digest(url)}),invite:url})});if(!remove.ok)throw new Error('Removal failed');a.close();b.close();console.log('Two independent peer identities exchanged an encrypted task; public discovery and owner-only removal passed.');


