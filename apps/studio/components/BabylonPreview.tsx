'use client';
import {useEffect,useRef,useState} from 'react';
import type {SceneObject} from '../core/site';
/** Adapted from Kinoinstrument's lazy engine lifecycle; no hosted model or CDN. */
export function BabylonPreview({objects}:{objects:SceneObject[]}){
  const canvas=useRef<HTMLCanvasElement>(null),[error,setError]=useState('');
  useEffect(()=>{let disposed=false,cleanup=()=>{};setError('');
    void import('@babylonjs/core').then(async B=>{
      if(disposed||!canvas.current)return;
      // WebGL avoids fetching WebGPU shader tooling and supports older consumer PCs.
      const engine=new B.Engine(canvas.current,true,{preserveDrawingBuffer:true,stencil:true});
      if(disposed){engine.dispose();return;}
      const scene=new B.Scene(engine);scene.clearColor=new B.Color4(.06,.09,.08,1);
      const camera=new B.ArcRotateCamera('camera',-Math.PI/2.35,Math.PI/2.9,10,new B.Vector3(0,1,0),scene);camera.attachControl(canvas.current,true);
      new B.HemisphericLight('light',new B.Vector3(0,1,0),scene);
      for(const o of objects){const mesh=o.kind==='sphere'?B.MeshBuilder.CreateSphere(o.id,{diameter:o.size},scene):o.kind==='cylinder'?B.MeshBuilder.CreateCylinder(o.id,{height:o.size,diameter:o.size},scene):B.MeshBuilder.CreateBox(o.id,{size:o.size},scene);mesh.position.set(o.x,o.y,o.z);const material=new B.StandardMaterial(o.id+'-material',scene);material.diffuseColor=B.Color3.FromHexString(o.color);mesh.material=material;}
      const resize=()=>engine.resize(),observer=new ResizeObserver(resize);observer.observe(canvas.current);engine.runRenderLoop(()=>{if(!document.hidden)scene.render();});
      cleanup=()=>{observer.disconnect();scene.dispose();engine.dispose();};
      if(disposed)cleanup();
    }).catch(e=>{if(!disposed)setError(`3D preview unavailable: ${String(e)}`);});
    return()=>{disposed=true;cleanup();};
  },[objects]);
  return <div className="stage">{error?<p role="alert">{error}</p>:<canvas ref={canvas} aria-label="Interactive BabylonJS scene"/>}<small>Drag to orbit · scroll to zoom</small></div>;
}
