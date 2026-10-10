'use client';
import {useEffect,useRef,useState} from 'react';
import type {VideoPlan,Media} from '../core/video';
/** The orb opens this only when a timeline preview is requested. Export stays FFmpeg. */
export function EtroPreview({planId}:{planId:string}){
  const canvas=useRef<HTMLCanvasElement>(null),movie=useRef<import('etro/dist/movie/movie').Movie|null>(null),[status,setStatus]=useState('Preparing timeline…'),[playing,setPlaying]=useState(false);
  useEffect(()=>{let disposed=false;let ctx:AudioContext|undefined;const elements:HTMLMediaElement[]=[];void(async()=>{
    const [module,plan,media]=await Promise.all([import('etro'),fetch('/api/video-projects/'+planId).then(r=>r.json()) as Promise<VideoPlan>,fetch('/api/media').then(r=>r.json()) as Promise<Media[]>]);const etro=module.default;if(disposed||!canvas.current)return;if(!plan.clips?.length)throw new Error('Add clips before previewing.');ctx=new AudioContext();const m=new etro.Movie({canvas:canvas.current,actx:ctx,background:new etro.Color(0,0,0,1)});m.width=plan.width;m.height=plan.height;let offset=0;
    for(const c of plan.clips){const source=media.find(a=>a.id===c.mediaId);if(!source)throw new Error('Timeline source is missing');const duration=c.duration/c.speed,scale=c.fit==='cover'?Math.max(plan.width/source.width,plan.height/source.height):Math.min(plan.width/source.width,plan.height/source.height),dw=source.width*scale,dh=source.height*scale;const visual={startTime:offset,duration,width:plan.width,height:plan.height,destWidth:dw,destHeight:dh,destX:(plan.width-dw)/2,destY:(plan.height-dh)/2,opacity:(layer:any)=>c.fade?Math.max(0,Math.min(1,layer.currentTime/c.fade,(duration-layer.currentTime)/c.fade)):1};
      if(source.still)m.addLayer(new etro.layer.Image({...visual,source:'/api/media/'+source.id}));else{const v=document.createElement('video');v.src='/api/media/'+source.id;v.preload='auto';v.playsInline=true;elements.push(v);m.addLayer(new etro.layer.Video({...visual,duration:c.duration,source:v,sourceStartTime:c.start,playbackRate:c.speed,volume:plan.music?.mode==='replace'?0:Math.min(1,c.volume)}));}
      if(c.caption)m.addLayer(new etro.layer.Text({startTime:offset,duration,text:c.caption,font:`${Math.round(plan.height*.045)}px Segoe UI`,color:new etro.Color(255,255,255,1),textAlign:'center',textX:plan.width/2,textY:plan.height-24,textBaseline:'bottom',width:plan.width,height:plan.height,maxWidth:plan.width-32}));offset+=duration;
    }
    if(plan.music){const audio=document.createElement('audio');audio.src='/api/media/'+plan.music.mediaId;audio.loop=!!plan.music.loop;elements.push(audio);m.addLayer(new etro.layer.Audio({source:audio,startTime:0,duration:offset,sourceStartTime:plan.music.start,volume:Math.min(1,plan.music.volume)}));}
    if(disposed){m.stop();void ctx.close();return;}movie.current=m;await m.refresh();if(!disposed)setStatus('Timeline preview • MP4 export uses FFmpeg');
  })().catch(e=>{if(!disposed)setStatus(String(e));});return()=>{disposed=true;movie.current?.stop();movie.current?.layers.splice(0);movie.current=null;elements.forEach(e=>{e.pause();e.removeAttribute('src');e.load();});void ctx?.close();};},[planId]);
  async function toggle(){const m=movie.current;if(!m)return;if(playing){m.pause();setPlaying(false);}else{await m.actx.resume();if(m.ended)m.seek(0);setPlaying(true);await m.play();setPlaying(false);}}
  return <div className="video-timeline"><canvas ref={canvas} aria-label="Etro video timeline preview"/><button onClick={()=>void toggle()}>{playing?'Pause':'Play timeline'}</button><p role="status">{status}</p></div>;
}
