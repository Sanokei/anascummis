import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { MAX_OPEN_SURFACES } from '@shared/types';
import type { SurfaceBlock, SurfaceWindow } from '@shared/types';

/**
 * Surfaces: what the assistant raises when a reply has something to show rather
 * than something to say.
 *
 * A window here is an object, not a card. It is dragged by its title bar,
 * resized from its corner, raised by touching it, and it never takes the page
 * hostage: the layer is `pointer-events: none` end to end, so the conversation
 * underneath stays live while anything is open and only the windows themselves
 * accept input.
 *
 * Geometry lives in refs and is written straight to the DOM. A drag that went
 * through React state would re-render every open window on every pointer move,
 * which is exactly what makes a floating window feel like a picture of one
 * rather than a thing being moved. React draws the contents; the refs own where
 * the box is.
 */

export interface SurfaceLayerProps {
  windows: SurfaceWindow[];
  /** Called when the person closes a window, or when the host closes one. */
  onDismiss: (id: string) => void;
  reducedMotion: boolean;
}

interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Gesture {
  pointerId: number;
  fromX: number;
  fromY: number;
  origin: Geometry;
}

/**
 * The handle a window shell is given on its layer. Everything a gesture needs
 * to start, and nothing it needs to keep asking for.
 */
interface WindowController {
  /** Attach the window's root; the layer positions it, z-orders it and focuses it through this. */
  attach: (node: HTMLElement | null) => void;
  /** Where the window is now. Read at the start of a gesture, never during render. */
  geometry: () => Geometry;
  /** Writes live geometry to the DOM and remembers it, without re-rendering. */
  set: (next: Geometry) => void;
  raise: () => void;
  dismiss: () => void;
}

const DEFAULT_SIZE = { width: 420, height: 320 };
const MIN_WIDTH = 280;
const MIN_HEIGHT = 160;
/** How much of a dragged window must stay on screen to be grabbable again. */
const MIN_VISIBLE_X = 96;
const TITLE_BAR_HEIGHT = 40;
/** Windows never touch the edge of the screen; the gap is what makes them objects. */
const VIEWPORT_GAP = 16;
const CASCADE_STEP = 30;
const CASCADE_ORIGIN = { x: 64, y: 88 };
const KEY_STEP = 16;
/** Long enough to register as an arrival, short enough not to sit over the page. */
const VEIL_HOLD_MS = 1100;
const VEIL_FADE_MS = 500;
const MOBILE_QUERY = '(max-width: 639px)';

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const ARROW_STEPS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function viewport(): { width: number; height: number } {
  // No layout to read means no windows to place; the fallback keeps the
  // arithmetic real rather than letting NaN reach a style value.
  if (typeof window === 'undefined') return { width: 1024, height: 768 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * The requested size, bounded by the minimums and then by the room there is.
 * Below 640px windows are sheets, so the 280px floor always fits on this path.
 */
function fitSize(
  requested: { width: number; height: number } | undefined,
  view: { width: number; height: number },
): { width: number; height: number } {
  const want = requested ?? DEFAULT_SIZE;
  return {
    width: Math.min(Math.max(want.width, MIN_WIDTH), Math.max(MIN_WIDTH, view.width - VIEWPORT_GAP * 2)),
    height: Math.min(
      Math.max(want.height, MIN_HEIGHT),
      Math.max(MIN_HEIGHT, view.height - VIEWPORT_GAP * 2),
    ),
  };
}

/**
 * Where a window that has never been seen goes. Successive windows step down
 * and right, wrapping within the number the host can hold open at once, so the
 * offset can never march off the bottom of the screen; the host enforces the
 * real ceiling. A step that a window already occupies is skipped, because two
 * windows exactly on top of each other read as one broken window.
 */
function placeWindow(
  size: { width: number; height: number },
  taken: Iterable<Geometry>,
  view: { width: number; height: number },
  sequence: number,
): Geometry {
  const occupied = [...taken];
  let spot = CASCADE_ORIGIN;

  for (let attempt = 0; attempt < MAX_OPEN_SURFACES; attempt += 1) {
    const step = (sequence + attempt) % MAX_OPEN_SURFACES;
    const candidate = {
      x: CASCADE_ORIGIN.x + step * CASCADE_STEP,
      y: CASCADE_ORIGIN.y + step * CASCADE_STEP,
    };
    const collides = occupied.some(
      (other) =>
        Math.abs(other.x - candidate.x) < CASCADE_STEP && Math.abs(other.y - candidate.y) < CASCADE_STEP,
    );
    if (!collides) {
      spot = candidate;
      break;
    }
  }

  return {
    x: clamp(spot.x, 0, Math.max(0, view.width - size.width)),
    y: clamp(spot.y, 0, Math.max(0, view.height - size.height)),
    width: size.width,
    height: size.height,
  };
}

/** A window may be pushed mostly off an edge, but never so far that its title bar cannot be reached. */
function clampToScreen(geometry: Geometry): Geometry {
  const view = viewport();
  return {
    ...geometry,
    x: clamp(geometry.x, -(geometry.width - MIN_VISIBLE_X), view.width - MIN_VISIBLE_X),
    y: clamp(geometry.y, 0, Math.max(0, view.height - TITLE_BAR_HEIGHT)),
  };
}

function clampToViewport(geometry: Geometry): Geometry {
  const view = viewport();
  return {
    ...geometry,
    width: clamp(geometry.width, MIN_WIDTH, Math.max(MIN_WIDTH, view.width - geometry.x)),
    height: clamp(geometry.height, MIN_HEIGHT, Math.max(MIN_HEIGHT, view.height - geometry.y)),
  };
}

/* ------------------------------------------------------------------ */
/* Prose                                                               */
/* ------------------------------------------------------------------ */

type ProsePiece = { kind: 'paragraph'; text: string } | { kind: 'bullets'; items: string[] };

/**
 * The closed vocabulary's one concession to formatting: blank lines separate
 * paragraphs and a line opening with "- " is a bullet. Nothing else is
 * interpreted, so what the assistant wrote is what appears.
 */
function readProse(text: string): ProsePiece[] {
  const pieces: ProsePiece[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) pieces.push({ kind: 'paragraph', text: paragraph.join(' ') });
    if (items.length > 0) pieces.push({ kind: 'bullets', items });
    paragraph = [];
    items = [];
  };

  for (const block of text.split(/\n{2,}/)) {
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('- ')) {
        // A bullet ends the paragraph above it, and prose after bullets starts
        // a new one, so a mixed block keeps its order instead of losing a half.
        if (paragraph.length > 0) flush();
        items.push(trimmed.slice(2).trim());
      } else {
        if (items.length > 0) flush();
        paragraph.push(trimmed);
      }
    }
    flush();
  }

  return pieces;
}

/* ------------------------------------------------------------------ */
/* Mobile                                                              */
/* ------------------------------------------------------------------ */

/**
 * Below 640px a floating window has nowhere to float. The layout switches to
 * sheets rather than trying to scale the desktop behaviour down.
 */
function useIsMobile(): boolean {
  const [matches, setMatches] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(MOBILE_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(MOBILE_QUERY);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    // The initial state above already reflects the query; this only follows it.
    setMatches(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return matches;
}

/* ------------------------------------------------------------------ */
/* The layer                                                           */
/* ------------------------------------------------------------------ */

export function SurfaceLayer({ windows, onDismiss, reducedMotion }: SurfaceLayerProps) {
  const isMobile = useIsMobile();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  /** The window whose arrival the veil belongs to, if the arrival is still new. */
  const [veiledId, setVeiledId] = useState<string | null>(null);
  const [veilFading, setVeilFading] = useState(false);

  const nodes = useRef(new Map<string, HTMLElement>());
  const geometry = useRef(new Map<string, Geometry>());
  /** The mobile sheet stack, measured so the page can reserve the room it takes. */
  const sheets = useRef<HTMLDivElement | null>(null);
  /**
   * Stacking levels, handed out monotonically. The counter is the whole point:
   * a level never has to be recomputed from the set a window sits in, so
   * raising one window touches one node and no React state.
   */
  const depth = useRef(new Map<string, number>());
  const depthSequence = useRef(0);
  const cascadeSequence = useRef(0);
  const restoreFocus = useRef<string | null>(null);

  const applyGeometry = useCallback((id: string, next: Geometry) => {
    const node = nodes.current.get(id);
    // Sheets are laid out by the stylesheet; there is no box to position.
    if (!node) return;
    node.style.width = `${next.width}px`;
    node.style.height = `${next.height}px`;
    node.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
  }, []);

  const raise = useCallback((id: string) => {
    depthSequence.current += 1;
    const level = depthSequence.current;
    depth.current.set(id, level);
    const node = nodes.current.get(id);
    if (node) node.style.zIndex = String(level);
    setFocusedId((current) => (current === id ? current : id));
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      const node = nodes.current.get(id);
      // Closing the window focus is inside would otherwise drop focus on <body>
      // and send the next Tab to the top of the page. Hand it to the window
      // that was in front instead.
      if (node && node.contains(document.activeElement)) {
        let nextTop: string | null = null;
        let topLevel = -1;
        for (const surface of windows) {
          if (surface.id === id) continue;
          const level = depth.current.get(surface.id) ?? 0;
          if (level > topLevel) {
            topLevel = level;
            nextTop = surface.id;
          }
        }
        restoreFocus.current = nextTop;
      }
      onDismiss(id);
    },
    [onDismiss, windows],
  );

  /* Placement, z-order and arrival. Runs before paint, so a window is never
     seen at the origin, and on every render, so a node that React remounted
     picks its geometry back up. */
  useLayoutEffect(() => {
    const present = new Set(windows.map((surface) => surface.id));
    for (const id of [...geometry.current.keys()]) if (!present.has(id)) geometry.current.delete(id);
    for (const id of [...depth.current.keys()]) if (!present.has(id)) depth.current.delete(id);

    for (const surface of windows) {
      const node = nodes.current.get(surface.id);
      const placed = geometry.current.get(surface.id);
      if (placed) {
        if (!isMobile) {
          applyGeometry(surface.id, placed);
          // A node React remounted — crossing the mobile breakpoint, say —
          // arrives with no level of its own. The level it earned stands.
          const level = depth.current.get(surface.id);
          if (node && level !== undefined) node.style.zIndex = String(level);
        }
        continue;
      }

      const view = viewport();
      const next = placeWindow(
        fitSize(surface.size, view),
        geometry.current.values(),
        view,
        cascadeSequence.current,
      );
      cascadeSequence.current += 1;
      geometry.current.set(surface.id, next);

      depthSequence.current += 1;
      depth.current.set(surface.id, depthSequence.current);

      if (!isMobile) {
        applyGeometry(surface.id, next);
        if (node) node.style.zIndex = String(depthSequence.current);
      }

      // Arrival, in the order the ladder promises: attention is the one case
      // that stages itself and takes focus, and nothing at all happens when the
      // person has asked for reduced motion.
      if (surface.emphasis === 'attention' && !reducedMotion) {
        setVeiledId(surface.id);
        node?.focus();
      }
    }
  });

  // The veil belongs to an arrival, not to the window's life. Holding it while
  // the person works underneath would make it a modal in disguise.
  useEffect(() => {
    if (!veiledId) return;
    setVeilFading(false);
    const hold = window.setTimeout(() => setVeilFading(true), VEIL_HOLD_MS);
    const done = window.setTimeout(() => setVeiledId(null), VEIL_HOLD_MS + VEIL_FADE_MS);
    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(done);
    };
  }, [veiledId]);

  useEffect(() => {
    if (veiledId && !windows.some((surface) => surface.id === veiledId)) {
      setVeiledId(null);
      setVeilFading(false);
    }
  }, [windows, veiledId]);

  // Deferred focus restore from a close. It waits for the host's removal to
  // actually land, and only takes focus that nothing else is holding.
  useEffect(() => {
    const id = restoreFocus.current;
    if (!id) return;
    if (!windows.some((surface) => surface.id === id)) {
      restoreFocus.current = null;
      return;
    }
    const node = nodes.current.get(id);
    if (!node) return;
    restoreFocus.current = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    node.focus();
  });

  useEffect(() => {
    const onResize = () => {
      for (const [id, current] of geometry.current) {
        const next = clampToScreen(current);
        geometry.current.set(id, next);
        if (!isMobile) applyGeometry(id, next);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isMobile, applyGeometry]);

  /*
   * Tell the page how much of the bottom of the screen the sheets are using.
   *
   * On a phone this layer is a fixed overlay, so nothing in the document's own
   * flow accounts for it — and the last thing the assistant said ended up
   * underneath the stack with no way to scroll it clear. A stack of sheets is
   * exactly as tall as whatever is in it, and that changes with every reply, so
   * the height is measured and published as a custom property rather than
   * guessed at. The page reserves the room; the layer keeps owning geometry.
   *
   * On a desktop there is nothing to reserve: windows float rather than sit on
   * the bottom edge, so the property is cleared and the page closes back up.
   */
  useEffect(() => {
    const root = document.documentElement;
    const node = sheets.current;
    if (!isMobile || !node) {
      root.style.removeProperty('--surface-sheet-height');
      return;
    }
    const publish = () => {
      // Layout height, not the painted rect: a sheet animating in has a
      // transform on it, and the page should reserve the room it will occupy
      // rather than the room it currently crosses.
      root.style.setProperty('--surface-sheet-height', `${node.offsetHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--surface-sheet-height');
    };
  }, [isMobile, windows.length]);

  // An empty layer is scenery with nothing in it. It must not even be in the
  // tree, so nothing about it can intercept a click.
  if (windows.length === 0) return null;

  const controllerFor = (id: string): WindowController => ({
    attach: (node) => {
      if (node) nodes.current.set(id, node);
      else nodes.current.delete(id);
    },
    geometry: () =>
      geometry.current.get(id) ?? {
        x: 0,
        y: 0,
        width: DEFAULT_SIZE.width,
        height: DEFAULT_SIZE.height,
      },
    set: (next) => {
      geometry.current.set(id, next);
      applyGeometry(id, next);
    },
    raise: () => raise(id),
    dismiss: () => dismiss(id),
  });

  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      {veiledId && !reducedMotion && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 transition-opacity duration-500 ${
            veilFading ? 'opacity-0' : 'opacity-100'
          }`}
        >
          {/*
            Kept very light: it isolates the arrival from the page behind it
            rather than darkening anything, and it passes every click through.
          */}
          <div className="veil-in bg-ground/55 absolute inset-0" />
        </div>
      )}

      {isMobile ? (
        /*
         * Below 640px the floating metaphor has nowhere to float: full-width
         * sheets stack up from the bottom of the screen instead.
         *
         * The stack is capped well short of the full height rather than at the
         * 85vh a lone sheet would be allowed. Ten of them in one scrolling
         * column would otherwise leave a strip of the conversation showing,
         * which reads as the page having broken rather than as sheets having
         * opened over it.
         */
        <div
          ref={sheets}
          className="absolute inset-x-0 bottom-0 flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto"
        >
          {windows.map((surface) => (
            <SurfaceSheet
              key={surface.id}
              surface={surface}
              focused={focusedId === surface.id}
              reducedMotion={reducedMotion}
              controller={controllerFor(surface.id)}
            />
          ))}
        </div>
      ) : (
        windows.map((surface) => (
          <FloatingWindow
            key={surface.id}
            surface={surface}
            focused={focusedId === surface.id}
            reducedMotion={reducedMotion}
            controller={controllerFor(surface.id)}
          />
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Floating window                                                     */
/* ------------------------------------------------------------------ */

interface ShellProps {
  surface: SurfaceWindow;
  focused: boolean;
  reducedMotion: boolean;
  controller: WindowController;
}

function FloatingWindow({ surface, focused, reducedMotion, controller }: ShellProps) {
  const drag = useRef<Gesture | null>(null);
  const resize = useRef<Gesture | null>(null);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Only a primary press on the bar is a drag.
    if (event.button !== 0) return;
    // A press that lands on a control belongs to that control. The bar covers
    // the close button, so the drag has to decline rather than swallow it.
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    event.preventDefault();
    drag.current = {
      pointerId: event.pointerId,
      fromX: event.clientX,
      fromY: event.clientY,
      origin: controller.geometry(),
    };
    // Capture on the bar itself: a drag that outruns the pointer keeps
    // arriving even after the cursor leaves the window, or the viewport.
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    controller.set(
      clampToScreen({
        ...gesture.origin,
        x: gesture.origin.x + (event.clientX - gesture.fromX),
        y: gesture.origin.y + (event.clientY - gesture.fromY),
      }),
    );
  };

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resize.current = {
      pointerId: event.pointerId,
      fromX: event.clientX,
      fromY: event.clientY,
      origin: controller.geometry(),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = resize.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    controller.set(
      clampToViewport({
        ...gesture.origin,
        width: gesture.origin.width + (event.clientX - gesture.fromX),
        height: gesture.origin.height + (event.clientY - gesture.fromY),
      }),
    );
  };

  const endGesture = (
    event: ReactPointerEvent<HTMLDivElement>,
    gesture: { current: Gesture | null },
  ) => {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  /**
   * Arrow keys are how a window is moved and resized without a pointer: the
   * bar is the handle either way, so the same keys cannot also be scrolling
   * the page underneath.
   */
  const onBarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const axis = ARROW_STEPS[event.key];
    if (!axis) return;
    event.preventDefault();
    const current = controller.geometry();
    if (event.shiftKey) {
      controller.set(
        clampToViewport({
          ...current,
          width: current.width + axis.x * KEY_STEP,
          height: current.height + axis.y * KEY_STEP,
        }),
      );
      return;
    }
    controller.set(
      clampToScreen({
        ...current,
        x: current.x + axis.x * KEY_STEP,
        y: current.y + axis.y * KEY_STEP,
      }),
    );
  };

  const onRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    // Escape belongs to the window while focus is inside it. Without this it
    // would reach the host's global handler as well and stop the turn too.
    event.stopPropagation();
    controller.dismiss();
  };

  const arriving = !reducedMotion && surface.emphasis !== 'quiet';

  return (
    <div
      ref={controller.attach}
      role="dialog"
      // Not modal, and honest about it: everything behind this layer is still
      // live and still clickable.
      aria-modal="false"
      aria-label={surface.title}
      tabIndex={-1}
      className="pointer-events-auto absolute top-0 left-0"
      onPointerDownCapture={(event) => {
        controller.raise();
        // Focus follows the hand, so Escape then closes the window the person
        // just touched. Pressing a plain div would otherwise leave focus on
        // <body> and hand Escape back to the host's global stop.
        event.currentTarget.focus({ preventScroll: true });
      }}
      onFocus={controller.raise}
      onKeyDown={onRootKeyDown}
    >
      <div
        className={`rounded-panel bg-ground-raised flex h-full w-full flex-col overflow-hidden border ${
          focused
            ? 'border-hairline-bright shadow-window-focused'
            : 'border-hairline shadow-window'
        } ${arriving ? 'window-arrive' : ''}`}
      >
        <div
          tabIndex={0}
          // The bar is the window's handle for the keyboard as well as the
          // pointer, so it says so where it becomes focusable.
          aria-label={`${surface.title}. Move with the arrow keys, resize with shift and the arrow keys.`}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={(event) => endGesture(event, drag)}
          onPointerCancel={(event) => endGesture(event, drag)}
          onKeyDown={onBarKeyDown}
          className="border-hairline flex cursor-grab touch-none items-start gap-2 border-b px-3 py-2 select-none active:cursor-grabbing"
        >
          <WindowTitle surface={surface} />
          <button
            type="button"
            onClick={controller.dismiss}
            aria-label={`Close ${surface.title}`}
            className="text-ink-faint hover:text-ink -mr-1 shrink-0 px-1 font-mono text-[0.68rem] tracking-wide uppercase"
          >
            Close
          </button>
        </div>

        <WindowBody surface={surface} />
      </div>

      {/*
        The corner grip is a pointer affordance only; the keyboard resizes with
        shift and the arrow keys, so this stays out of the tab order and out of
        the accessibility tree rather than being a control nobody can operate.
      */}
      <div
        aria-hidden="true"
        onPointerDown={beginResize}
        onPointerMove={moveResize}
        onPointerUp={(event) => endGesture(event, resize)}
        onPointerCancel={(event) => endGesture(event, resize)}
        className="absolute right-0 bottom-0 h-4 w-4 cursor-nwse-resize touch-none"
      >
        <span className="border-hairline-bright pointer-events-none absolute right-[3px] bottom-[3px] block h-2.5 w-2.5 border-r border-b" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sheet                                                               */
/* ------------------------------------------------------------------ */

function SurfaceSheet({ surface, focused, reducedMotion, controller }: ShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const arriving = !reducedMotion && surface.emphasis !== 'quiet';

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    controller.dismiss();
  };

  return (
    <section
      ref={controller.attach}
      role="dialog"
      aria-modal="false"
      aria-label={surface.title}
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        controller.raise();
        // Same reasoning as the floating window: a sheet that has just been
        // touched is the one Escape should close.
        event.currentTarget.focus({ preventScroll: true });
      }}
      onFocus={controller.raise}
      onKeyDown={onKeyDown}
      className={`rounded-t-panel bg-ground-raised pointer-events-auto flex max-h-[80vh] shrink-0 flex-col overflow-hidden border border-b-0 ${
        focused ? 'border-hairline-bright shadow-window-focused' : 'border-hairline shadow-window'
      } ${arriving ? 'window-arrive' : ''}`}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
          className="min-w-0 flex-1 text-left"
        >
          <WindowTitle surface={surface} />
        </button>
        <button
          type="button"
          onClick={controller.dismiss}
          aria-label={`Close ${surface.title}`}
          className="text-ink-faint hover:text-ink -mr-1 shrink-0 px-1 font-mono text-[0.68rem] tracking-wide uppercase"
        >
          Close
        </button>
      </div>
      {/* Collapsing is what keeps a stack of sheets from using the whole
          screen: the title bars alone stay, and the conversation stays visible. */}
      {!collapsed && <WindowBody surface={surface} />}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Contents                                                            */
/* ------------------------------------------------------------------ */

/**
 * The title, the subtitle, and what raised the window. `raisedBy` is the
 * assistant saying why this is in front of you; it sits apart from the subtitle
 * by type rather than by a label, because it is a remark and not a field.
 */
function WindowTitle({ surface }: { surface: SurfaceWindow }) {
  return (
    // Spans rather than a div: the same block is the contents of the sheet's
    // disclosure button, where a div would not be allowed.
    <span className="block min-w-0 flex-1">
      <span className="block truncate font-mono text-[0.72rem] tracking-wide uppercase">
        {surface.title}
      </span>
      {surface.subtitle && (
        <span className="text-ink-dim block truncate text-[0.78rem]">{surface.subtitle}</span>
      )}
      {surface.raisedBy && (
        <span className="text-ink-faint mt-0.5 line-clamp-2 font-mono text-[0.68rem]">
          {surface.raisedBy}
        </span>
      )}
    </span>
  );
}

function WindowBody({ surface }: { surface: SurfaceWindow }) {
  const baseId = useId();
  const tabs = surface.tabs;
  const firstId = tabs[0]?.id;
  const [activeId, setActiveId] = useState<string | undefined>(surface.activeTabId ?? firstId);

  // The host brings a tab forward by naming it. Until it names a different one,
  // whichever tab the person opened is the one they keep.
  useEffect(() => {
    setActiveId(surface.activeTabId ?? firstId);
  }, [surface.activeTabId, firstId]);

  // A window with no tabs has nothing to draw; the title bar is the whole of it.
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  if (!activeTab) return null;

  const multiple = tabs.length > 1;

  const onTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    let next: number | null = step === 0 ? null : (index + step + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    const target = tabs[next];
    if (!target) return;
    event.preventDefault();
    setActiveId(target.id);
    document.getElementById(`${baseId}-tab-${target.id}`)?.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {multiple && (
        <div
          role="tablist"
          aria-label={`${surface.title} tabs`}
          className="border-hairline flex shrink-0 gap-1 overflow-x-auto border-b px-2"
        >
          {tabs.map((tab, index) => {
            const selected = tab.id === activeTab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${baseId}-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                // Roving tabindex: the strip is one stop, arrows move within it.
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveId(tab.id)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                className={`shrink-0 border-b-2 px-2 py-1.5 font-mono text-[0.68rem] tracking-wide uppercase ${
                  selected
                    ? 'border-signal text-ink'
                    : 'text-ink-dim hover:text-ink border-transparent'
                }`}
              >
                {tab.title}
                {tab.badge && <span className="text-ink-faint ml-1.5">{tab.badge}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div
        id={`${baseId}-panel`}
        role={multiple ? 'tabpanel' : undefined}
        aria-labelledby={multiple ? `${baseId}-tab-${activeTab.id}` : undefined}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {activeTab.blocks.length === 0 ? (
          <p className="text-ink-faint text-[0.85rem]">Nothing in this tab.</p>
        ) : (
          activeTab.blocks.map((block) => <SurfaceBlockView key={block.id} block={block} />)
        )}
      </div>
    </div>
  );
}

function SurfaceBlockView({ block }: { block: SurfaceBlock }) {
  const header = Boolean(block.title) || (block.kind === 'code' && Boolean(block.language));
  return (
    <section className="mb-4 last:mb-0">
      {header && (
        <div className="mb-1 flex items-baseline gap-2">
          {block.title && (
            <h3 className="text-ink-faint font-mono text-[0.68rem] tracking-wide uppercase">
              {block.title}
            </h3>
          )}
          {block.kind === 'code' && block.language && (
            <span className="text-ink-faint ml-auto shrink-0 font-mono text-[0.65rem] uppercase">
              {block.language}
            </span>
          )}
        </div>
      )}
      <SurfaceBlockBody block={block} />
      {block.caption && (
        <p className="text-ink-faint mt-1.5 text-[0.78rem]">{block.caption}</p>
      )}
    </section>
  );
}

function SurfaceBlockBody({ block }: { block: SurfaceBlock }) {
  switch (block.kind) {
    case 'image':
      // The contract requires alt text on every image the host lets through, so
      // an empty one here means a decorative image rather than a missing label.
      if (!block.url) return null;
      return (
        <img
          src={block.url}
          alt={block.alt ?? ''}
          loading="lazy"
          // A surfaced image is fetched from wherever it lives, and that request
          // should carry nothing about where it was shown.
          referrerPolicy="no-referrer"
          className="border-hairline rounded-block max-w-full border"
        />
      );

    case 'code':
      // Drawn as text and never as anything else. The vocabulary is closed
      // precisely so that a surface cannot ask the client to run something.
      return (
        <pre className="border-hairline bg-ground-sunken rounded-block overflow-x-auto border p-3 font-mono text-[0.78rem] leading-relaxed">
          <code>{block.text ?? ''}</code>
        </pre>
      );

    case 'list':
      if (!block.items?.length) return null;
      return (
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {block.items.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ul>
      );

    case 'fields':
      if (!block.fields?.length) return null;
      return (
        <dl className="flex flex-col gap-1.5">
          {block.fields.map((field, index) => (
            // A div between dl and its pairs is the grouping the HTML spec
            // expects; it keeps a long value from pushing its label off the row.
            <div
              key={`${index}-${field.label}`}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3"
            >
              <dt className="text-ink-faint font-mono text-[0.68rem] tracking-wide uppercase">
                {field.label}
              </dt>
              <dd className="text-ink-dim min-w-0 break-words">{field.value}</dd>
            </div>
          ))}
        </dl>
      );

    case 'links':
      if (!block.links?.length) return null;
      return (
        <ul className="flex flex-col gap-1">
          {block.links.map((link, index) => (
            <li key={`${index}-${link.href}`}>
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-signal decoration-signal-dim underline underline-offset-2"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      );

    case 'text':
      return <Prose text={block.text ?? ''} />;

    default:
      return null;
  }
}

function Prose({ text }: { text: string }) {
  const pieces = readProse(text);
  if (pieces.length === 0) return null;
  return (
    <div className="prose-voice">
      {pieces.map((piece, index) =>
        piece.kind === 'bullets' ? (
          <ul key={index} className="mb-2 flex list-disc flex-col gap-1 pl-5">
            {piece.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={index}>{piece.text}</p>
        ),
      )}
    </div>
  );
}
