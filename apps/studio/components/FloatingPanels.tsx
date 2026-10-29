'use client';
import {memo, useEffect, useRef, useState, type ReactNode} from 'react';
import {Layout, Model, Actions, Rect, type Action, type IJsonRect, type TabNode} from 'flexlayout-react';
export type FloatingPanel = {id: string; title: string; reason: string; version: string; content: ReactNode};

function fitFloat(rect: IJsonRect, width: number, height: number) {
  const gutterX = Math.min(16, width / 4), gutterY = Math.min(16, height / 4);
  const top = Math.min(72, height / 3);
  const nextWidth = Math.min(Math.max(1, rect.width), Math.max(1, width - gutterX * 2));
  const nextHeight = Math.min(Math.max(1, rect.height), Math.max(1, height - top - gutterY));
  return new Rect(
    Math.min(Math.max(gutterX, rect.x), width - gutterX - nextWidth),
    Math.min(Math.max(top, rect.y), height - gutterY - nextHeight),
    nextWidth, nextHeight
  );
}

/** Stable FlexLayout surfaces; viewport changes adjust floats without discarding their tabs. */
export const FloatingPanels = memo(function FloatingPanels({panels, onDismiss, raiseRequest}: {panels: FloatingPanel[]; onDismiss: (id: string) => void; raiseRequest?: {id: string; key: number}}) {
  const [model, setModel] = useState(() => Model.fromJson({global: {tabEnablePopout: false, tabEnableFloat: true, tabEnableFloatIcon: false, tabSetEnableMaximize: false, tabSetEnableDeleteWhenEmpty: true, enableEdgeDock: false}, layout: {type: 'row', id: 'conversation-room', children: []}}));
  const modelRef = useRef(model); modelRef.current = model;
  const shell = useRef<HTMLDivElement>(null);
  const content = useRef(panels); content.current = panels;
  const known = useRef(new Map<string, string>());
  const preferredRects = useRef(new Map<string, IJsonRect>());
  const fitting = useRef(false);
  const handledRaise = useRef<{id: string; key: number} | undefined>(undefined);

  useEffect(() => {
    for (const [id] of known.current) {
      if (!panels.some(panel => panel.id === id)) {
        if (model.getNodeById(id)) model.doAction(Actions.deleteTab(id));
        known.current.delete(id);
      }
    }
    for (const panel of panels) {
      if (known.current.has(panel.id)) {
        const node = model.getNodeById(panel.id) as TabNode | undefined;
        if (node && node.getName() !== panel.title) model.doAction(Actions.updateNodeAttributes(panel.id, {name: panel.title, helpText: panel.reason}));
        continue;
      }
      const sequence = known.current.size, width = Math.max(1, Math.min(400, innerWidth - 32)), height = Math.max(1, Math.min(440, innerHeight - 96));
      const preferred = {x: innerWidth < 700 ? 16 : sequence % 2 ? 24 : Math.max(24, innerWidth - width - 24), y: 72 + Math.floor(sequence / 2) * 32, width, height};
      const layoutId = model.doAction(Actions.createPopout({type: 'row', children: [{type: 'tabset', name: panel.title, children: [{type: 'tab', id: panel.id, name: panel.title, component: 'surface', helpText: panel.reason}]}]}, fitFloat(preferred, innerWidth, innerHeight).toJson(), 'float')) as string;
      preferredRects.current.set(layoutId, preferred);
      known.current.set(panel.id, layoutId);
    }
    if (raiseRequest && (handledRaise.current?.id !== raiseRequest.id || handledRaise.current?.key !== raiseRequest.key)) {
      const node = model.getNodeById(raiseRequest.id);
      if (node) {
        model.doAction(Actions.selectTab(raiseRequest.id));
        const layoutId = node.getLayoutId();
        if (model.toJson().subLayouts?.[layoutId]?.type === 'float') model.doAction(Actions.movePopoutToFront(layoutId));
        handledRaise.current = {...raiseRequest};
      }
    }
  }, [panels, model, raiseRequest?.id, raiseRequest?.key]);

  useEffect(() => {
    let frame: number | undefined;
    function fitToViewport() {
      frame = undefined;
      const bounds = shell.current?.getBoundingClientRect();
      const width = Math.min(innerWidth, bounds?.width || innerWidth), height = Math.min(innerHeight, bounds?.height || innerHeight);
      if (width <= 0 || height <= 0) return;
      const current = modelRef.current, layouts = current.toJson().subLayouts || {};
      let changed = false;
      fitting.current = true;
      try {
        for (const [id, layout] of Object.entries(layouts)) {
          if (layout.type !== 'float' || !layout.rect) continue;
          const preferred = preferredRects.current.get(id) || layout.rect;
          preferredRects.current.set(id, preferred);
          const rect = fitFloat(preferred, width, height);
          if (!rect.equals(Rect.fromJson(layout.rect))) {
            current.doAction(Actions.moveFloat(id, rect));
            changed = true;
          }
        }
      } finally {fitting.current = false;}
      for (const id of preferredRects.current.keys()) if (!layouts[id]) preferredRects.current.delete(id);
      if (changed) {
        // FlexLayout floats cache their rendered rect. Its documented model adoption
        // refreshes the layout reference while retaining matching tab view state.
        const next = Model.fromJson(current.toJson(), current);
        modelRef.current = next;
        setModel(next);
      }
    }
    function scheduleFit() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitToViewport);
    }
    const observer = new ResizeObserver(scheduleFit);
    if (shell.current) observer.observe(shell.current);
    window.addEventListener('resize', scheduleFit);
    scheduleFit();
    return () => {observer.disconnect(); window.removeEventListener('resize', scheduleFit); if (frame !== undefined) cancelAnimationFrame(frame);};
  }, []);

  function onModelChange(current: Model, action: Action) {
    if (!fitting.current && action.type === Actions.MOVE_FLOAT) {
      const rect = action.data.rect as IJsonRect;
      if (typeof action.data.layoutId === 'string' && rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
        preferredRects.current.set(action.data.layoutId, {...rect});
      }
    }
    for (const [id] of known.current) if (!current.getNodeById(id)) {known.current.delete(id); onDismiss(id);}
  }
  const factory = (node: TabNode) => <div className="floating-panel-content" aria-label={node.getName()}>{content.current.find(panel => panel.id === node.getId())?.content}</div>;
  return <div ref={shell} className="floating-surface-layer"><Layout model={model} factory={factory} supportsPopout={false} constrainFloatPanels onModelChange={onModelChange}/></div>;
}, (before, after) => before.raiseRequest?.id === after.raiseRequest?.id && before.raiseRequest?.key === after.raiseRequest?.key && before.panels.length === after.panels.length && before.panels.every((panel, index) => panel.id === after.panels[index].id && panel.title === after.panels[index].title && panel.version === after.panels[index].version));
