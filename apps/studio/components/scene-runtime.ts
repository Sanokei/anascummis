import {Engine,Scene,ArcRotateCamera,Vector3,Color3,Color4,HemisphericLight,MeshBuilder,StandardMaterial} from '@babylonjs/core';
import {initialSite,validateSite} from '../core/site';
const source=document.getElementById('scene-source'),canvas=document.getElementById('business-scene');
if(source&&canvas instanceof HTMLCanvasElement){
  const objects=validateSite({...initialSite(),scene:JSON.parse(source.textContent||'[]')}).scene;
  const engine=new Engine(canvas,true),scene=new Scene(engine);scene.clearColor=new Color4(.06,.09,.08,1);
  const camera=new ArcRotateCamera('camera',-Math.PI/2.35,Math.PI/2.9,10,new Vector3(0,1,0),scene);camera.attachControl(canvas,true);new HemisphericLight('light',new Vector3(0,1,0),scene);
  for(const o of objects){const mesh=o.kind==='box'?MeshBuilder.CreateBox(o.id,{size:o.size},scene):o.kind==='sphere'?MeshBuilder.CreateSphere(o.id,{diameter:o.size},scene):MeshBuilder.CreateCylinder(o.id,{height:o.size,diameter:o.size},scene);mesh.position.set(o.x,o.y,o.z);const material=new StandardMaterial(o.id,scene);material.diffuseColor=Color3.FromHexString(o.color);mesh.material=material;}
  const observer=new ResizeObserver(()=>engine.resize());observer.observe(canvas);engine.runRenderLoop(()=>{if(!document.hidden)scene.render();});window.addEventListener('pagehide',()=>{observer.disconnect();scene.dispose();engine.dispose();},{once:true});
}
