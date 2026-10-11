'use client';
import {memo,useEffect,useRef,useState,type ReactNode} from 'react';
import {Layout,Model,Actions,type TabNode} from 'flexlayout-react';
export type FloatingPanel={id:string;title:string;reason:string;version:string;content:ReactNode};
/** Implements the original stable surface contract using real FlexLayout float sublayouts. */
export const FloatingPanels=memo(function FloatingPanels({panels,onDismiss}:{panels:FloatingPanel[];onDismiss:(id:string)=>void}){
  const [model]=useState(()=>Model.fromJson({global:{tabEnablePopout:false,tabEnableFloat:true,tabEnableFloatIcon:false,tabSetEnableMaximize:false,tabSetEnableDeleteWhenEmpty:true,enableEdgeDock:false},layout:{type:'row',id:'conversation-room',children:[]}}));
  const content=useRef(panels);content.current=panels;
  const known=useRef(new Map<string,string>());
  useEffect(()=>{
    for(const [id,layoutId] of known.current){if(!panels.some(p=>p.id===id)){if(model.getNodeById(id))model.doAction(Actions.deleteTab(id));known.current.delete(id);}}
    for(const panel of panels){
      if(known.current.has(panel.id)){const node=model.getNodeById(panel.id) as TabNode|undefined;if(node&&node.getName()!==panel.title)model.doAction(Actions.updateNodeAttributes(panel.id,{name:panel.title,helpText:panel.reason}));continue;}
      const sequence=known.current.size,width=Math.min(400,innerWidth-32),height=Math.min(440,innerHeight-96);
      const x=innerWidth<700?16:sequence%2?24:Math.max(24,innerWidth-width-24),y=72+Math.floor(sequence/2)*32;
      const layoutId=model.doAction(Actions.createPopout({type:'row',children:[{type:'tabset',name:panel.title,children:[{type:'tab',id:panel.id,name:panel.title,component:'surface',helpText:panel.reason}]}]},{x,y,width,height},'float'));
      known.current.set(panel.id,layoutId);
    }
  },[panels,model]);
  const factory=(node:TabNode)=><div className="floating-panel-content" aria-label={node.getName()}>{content.current.find(p=>p.id===node.getId())?.content}</div>;
  return <div className="floating-surface-layer"><Layout model={model} factory={factory} supportsPopout={false} constrainFloatPanels onModelChange={()=>{for(const [id] of known.current){if(!model.getNodeById(id)){known.current.delete(id);onDismiss(id);}}}}/></div>;
},(before,after)=>before.panels.length===after.panels.length&&before.panels.every((panel,i)=>panel.id===after.panels[i].id&&panel.title===after.panels[i].title&&panel.version===after.panels[i].version));