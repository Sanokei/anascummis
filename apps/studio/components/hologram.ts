import type {SphereFrame} from './orb-draw';
/** Light over the original sphere; geometry, blobs and motion stay intact. */
export function holographicLight(ctx:CanvasRenderingContext2D,frame:SphereFrame){
  const {size,level,mood,openness}=frame;
  const radius=size*.3*mood.radius*openness*(1+level*.075);
  ctx.save();ctx.translate(size/2,size/2);ctx.globalCompositeOperation='screen';
  ctx.shadowColor='rgba(31,212,255,.55)';ctx.shadowBlur=size*.025;
  ctx.strokeStyle='rgba(113,231,255,.24)';ctx.lineWidth=.9;
  ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;
  ctx.beginPath();ctx.arc(0,0,radius*.99,0,Math.PI*2);ctx.clip();
  ctx.strokeStyle='rgba(176,245,255,.10)';ctx.lineWidth=.55;
  const offset=frame.still?0:(frame.time*.7)%4;
  for(let y=-radius+offset;y<radius;y+=4){ctx.beginPath();ctx.moveTo(-radius,y);ctx.lineTo(radius,y);ctx.stroke();}
  const fringe=ctx.createLinearGradient(-radius,0,radius,0);
  fringe.addColorStop(0,'rgba(79,214,255,.09)');fringe.addColorStop(.55,'rgba(255,255,255,0)');fringe.addColorStop(1,'rgba(185,153,255,.11)');
  ctx.fillStyle=fringe;ctx.fillRect(-radius,-radius,radius*2,radius*2);ctx.restore();
}
