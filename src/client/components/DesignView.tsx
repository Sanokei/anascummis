import { useEffect, useMemo, useState } from 'react';
/*
 * The verdict vocabulary is imported from the module that defines it rather
 * than restated here. `src/worker/design/types.ts` imports nothing at all — it
 * is types and three constants — so this is a type-only import: the compiler
 * erases it and no Worker code reaches the client bundle. That matters, because
 * this component's entire job is to show the difference between a verdict a
 * host check settled and one a model offered, and a second copy of those words
 * would be free to drift from the first.
 */
import type {
  CheckRefusal,
  DesignReview,
  Outcome,
  Surface,
  VerdictBasis,
} from '../../worker/design/types';
// One description of what `/api/session` returns under `capabilities.design`,
// shared with the client type rather than restated here.
import type { DesignAvailability } from '../api';
export type { DesignAvailability };

/**
 * A design lab's result, shown for what it is.
 *
 * This component exists because of one failure mode, and it is laid out so that
 * failure is impossible to miss. A vision model's confident description of a
 * picture is not a verification, so every criterion below carries the word for
 * how it was settled, and the three ways do not look alike:
 *
 *   - A **solid** rule is a measurement. A host check ran over the source or
 *     the pixels, and the numbers it used are printed with it. This is the only
 *     basis that can carry "met" as a result.
 *   - A **dashed** rule is a claim. A vision model looked at the render and
 *     answered. It is shown, it is attributed, and it is never green.
 *   - A **dotted**, faint rule is an absence. Nobody settled it. It is drawn as
 *     missing rather than as a mild success, and it says in words that it is
 *     not a pass.
 *
 * The rule's *shape* carries the distinction as much as its colour does, which
 * is the point: the basis is spelled out on every row, so the reading survives
 * a monochrome screen, a colour-blind reader, and a screenshot.
 *
 * The component displays a result; it does not produce one. The design
 * capabilities are called through the ordinary turn path, so everything here
 * arrives as props, and nothing here calls a provider, a browser or a model.
 */

/* ------------------------------------------------------------------ */
/* The shape of what arrives                                           */
/* ------------------------------------------------------------------ */

/**
 * One criterion, as it reaches the client.
 *
 * Two shapes of this exist, and both are accepted rather than one being
 * declared correct. `design.submit` flattens the host finding and the model's
 * view into a single `evidence` string; `design.read` returns the recorded
 * verdict verbatim, with the two findings still in their own fields. The basis
 * decides which of them is load-bearing, so the row can be drawn either way.
 */
export interface DesignVerdict {
  criterion: string;
  basis: VerdictBasis;
  outcome: Outcome;
  /** The flattened evidence line, from a submit result. */
  evidence?: string;
  /** The host finding, from a read result. */
  verified?: { outcome: string; evidence: string } | null;
  /** The model's view, from a read result. */
  opinion?: { outcome: string; evidence: string } | null;
  /** Present when the two disagreed. The check stands; this records the objection. */
  conflict?: string | null;
}

/**
 * A problem with the source itself, as opposed to a criterion that failed.
 *
 * Declared here rather than imported because the Worker's two issue types are
 * `SvgIssue` and `SceneIssue` — different code sets for different surfaces —
 * and what crosses to a client is the intersection of them, which is this.
 */
export interface DesignIssue {
  code: string;
  message: string;
}

/**
 * Props are the fields of a `design.submit` result, named as the wire names
 * them, plus the lab identity the byte route needs. Named this way so the
 * wiring is a spread rather than a transcription:
 *
 *   <DesignView {...result} labId={labId} surface={surface} availability={...} />
 */
export interface DesignViewProps {
  /** Both ids are required: the byte route is addressed by lab, revision and file. */
  labId: string;
  revisionId: string;
  surface: Surface;
  title?: string;
  /** The round just recorded, and the ceiling on rounds for this lab. */
  round?: number;
  maxRounds?: number;
  /** One entry per criterion, in the order the criteria were written. */
  verdicts: DesignVerdict[];
  /** Four tallies, deliberately not a partition. See the counts block below. */
  counts: DesignReview['counts'];
  /** Criteria the harness declined to compile, with the reason it gave. */
  refused: CheckRefusal[];
  /** Problems with the source. These are about the artifact, not the criteria. */
  issues: DesignIssue[];
  /** View name to storage key. The file to request is the key's last segment. */
  renderKeys: Record<string, string>;
  /** Storage key of the exported mesh, for a scene. */
  glbKey?: string | null;
  /** Why nothing could be rendered, when nothing could. */
  unrendered?: string | null;
  /** True only when every criterion was settled met by a host check. */
  allVerified?: boolean;
  /** The model that answered the opinion-only criteria, when one did. */
  reviewedBy?: string | null;
  otherObservations?: string[];
  /** Travels with every review, and is shown in full. */
  caveat: string;
  availability?: DesignAvailability | null;
}

/* ------------------------------------------------------------------ */
/* The component                                                       */
/* ------------------------------------------------------------------ */

export function DesignView(props: DesignViewProps) {
  const { labId, revisionId, surface, renderKeys, glbKey, unrendered, availability } = props;

  const views = useMemo(() => orderedViews(renderKeys), [renderKeys]);
  // Held as a view *name* rather than an index, so a re-render with a different
  // revision falls back to that revision's first view instead of pointing at
  // whatever happens to sit at the old index.
  const [chosen, setChosen] = useState<string | null>(null);
  const active = views.find((entry) => entry.view === chosen) ?? views[0] ?? null;

  const render = useStoredBytes(active ? renderUrl(labId, revisionId, active.file) : null);
  const meshFile = glbKey ? fileName(glbKey) : null;
  const mesh = useStoredBytes(meshFile ? renderUrl(labId, revisionId, meshFile) : null);

  const renderer =
    surface === 'vector' ? (availability?.vector ?? null) : (availability?.scene ?? null);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-0.5">
        <p className="text-ink-faint font-mono text-[0.68rem] tracking-wide uppercase">
          {surface}
          {typeof props.round === 'number' && (
            <>
              {' · round '}
              {props.round}
              {typeof props.maxRounds === 'number' ? ` of ${props.maxRounds}` : ''}
            </>
          )}
        </p>
        {props.title && <p className="text-[0.95rem]">{props.title}</p>}
        {/*
          The one affirmative sentence this interface is entitled to make about
          a design. It is said only when a host check settled every criterion,
          never on the strength of an opinion.
        */}
        {props.allVerified && (
          <p className="text-affirm text-[0.85rem]">
            Every criterion was settled met by a check against the source or the pixels.
          </p>
        )}
      </header>

      {/* Landmark names repeat their visible heading, so a screen reader hears
          the same word for a region as the one printed above it. */}
      <section aria-label="From the source" className="flex flex-col gap-2">
        <h3 className={HEADING}>From the source</h3>

        {/*
          A renderer that is not configured is the reason an empty frame would
          otherwise be mystifying, so the reason is shown before the frame.
        */}
        {renderer && !renderer.available && (
          <p className="text-ink-faint text-[0.8rem]">{renderer.reason}</p>
        )}

        {unrendered && (
          <div className="border-hairline bg-ground-sunken rounded-[var(--radius-block)] border p-3">
            <p className="text-[0.85rem]">
              Nothing was rendered this round, so no criterion could be settled against the pixels.
            </p>
            <p className="text-ink-dim mt-1 text-[0.82rem]">{unrendered}</p>
          </div>
        )}

        {active && (
          <>
            <div className="border-hairline bg-ground-sunken flex items-center justify-center overflow-hidden rounded-[var(--radius-block)] border p-2">
              {render.status === 'ready' ? (
                <img
                  src={render.url}
                  alt={altText(surface, active.view)}
                  className="max-h-[360px] w-auto max-w-full"
                />
              ) : render.status === 'loading' ? (
                <p className="text-ink-faint py-10 font-mono text-[0.72rem]">
                  Fetching the render
                </p>
              ) : render.status === 'absent' ? (
                /*
                 * The byte route answers 404 both for a key that belongs to
                 * another session and for one that has expired, and it does not
                 * say which. Neither claim is made here.
                 */
                <p className="text-ink-faint py-10 text-center text-[0.82rem]">
                  Not available in this session.
                </p>
              ) : (
                <p className="text-caution py-10 text-center text-[0.82rem]">{render.message}</p>
              )}
            </div>

            {views.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {views.map((entry) => (
                  <button
                    key={entry.view}
                    type="button"
                    aria-pressed={entry.view === active.view}
                    onClick={() => setChosen(entry.view)}
                    className={`rounded-full border px-2.5 py-1 font-mono text-[0.68rem] transition-colors ${
                      entry.view === active.view
                        ? 'border-signal text-signal'
                        : 'border-hairline text-ink-faint hover:border-hairline-bright hover:text-ink-dim'
                    }`}
                  >
                    {entry.view}
                  </button>
                ))}
              </div>
            )}

            <p className="text-ink-faint font-mono text-[0.68rem]">
              {viewNote(active.view)} · {active.file}
              {render.status === 'ready' ? ` · ${formatBytes(render.bytes)}` : ''}
            </p>
          </>
        )}

        {!active && !unrendered && (
          <p className="text-ink-faint text-[0.82rem]">No render is stored for this revision.</p>
        )}

        {meshFile && <MeshRow file={meshFile} state={mesh} />}
      </section>

      <Counts counts={props.counts} />

      <section aria-label="Criteria" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 className={HEADING}>Criteria · {props.verdicts.length}</h3>
          {/*
            Every opinion is attributable. The model is named here rather than
            implied, so "a model said so" is never anonymous.
          */}
          {props.reviewedBy && (
            <p className="text-ink-faint font-mono text-[0.68rem]">
              opinions from {props.reviewedBy}
            </p>
          )}
        </div>

        {props.verdicts.length === 0 ? (
          <p className="text-ink-faint text-[0.82rem]">No criteria were checked.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {props.verdicts.map((verdict, index) => (
              // Keyed by position because criteria are authored text and two of
              // them can be worded identically.
              <VerdictRow key={`${index}-${verdict.criterion}`} verdict={verdict} />
            ))}
          </ul>
        )}

        {availability && !availability.review.available && (
          <p className="text-ink-faint text-[0.8rem]">
            No vision review is configured here ({availability.review.reason}), so a criterion no
            check could settle stays unverifiable rather than being answered by a model.
          </p>
        )}
      </section>

      {/*
        A refusal is a first-class part of the output, not an error to hide: it
        is the harness saying what it will not pretend to check.
      */}
      {props.refused.length > 0 && (
        <section aria-label="Declined to check" className="flex flex-col gap-2">
          <h3 className={HEADING}>Declined to check · {props.refused.length}</h3>
          <p className="text-ink-faint text-[0.78rem]">
            These criteria were not compiled into checks at all. A refusal names what it could have
            checked instead, and it is not a criterion that failed quietly.
          </p>
          <ul className="flex flex-col gap-2.5">
            {props.refused.map((refusal, index) => (
              <li
                key={`${index}-${refusal.criterion}`}
                className="border-hairline border-l-2 border-dotted pl-3"
              >
                <p className="text-[0.88rem]">{refusal.criterion}</p>
                <p className="text-ink-dim text-[0.82rem]">{refusal.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {props.issues.length > 0 && (
        <section aria-label="Problems with the source" className="flex flex-col gap-2">
          <h3 className={HEADING}>Problems with the source · {props.issues.length}</h3>
          <ul className="flex flex-col gap-2">
            {props.issues.map((issue, index) => (
              <li key={`${index}-${issue.code}`} className="flex flex-col gap-0.5">
                <span className="text-caution font-mono text-[0.68rem]">{issue.code}</span>
                <span className="text-ink-dim text-[0.84rem]">{issue.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {props.otherObservations && props.otherObservations.length > 0 && (
        <section aria-label="Also seen, opinion only" className="flex flex-col gap-2">
          <h3 className={HEADING}>Also seen · opinion only</h3>
          <p className="text-ink-faint text-[0.78rem]">
            Noticed by the model while it looked, about nothing that was asked. No check stands
            behind any of these.
          </p>
          <ul className="flex flex-col gap-1.5">
            {props.otherObservations.map((observation, index) => (
              <li key={index} className="border-hairline border-dashed border-l-2 pl-3 text-[0.84rem]">
                {observation}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        In full, always. The caveat is the sentence that says what everything
        above it is worth, and one trimmed to fit would be worse than none.
      */}
      <section aria-label="Caveat" className="border-hairline border-t pt-3">
        <h3 className={HEADING}>Caveat</h3>
        <p className="text-ink-dim text-[0.8rem]">{props.caveat}</p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One criterion                                                       */
/* ------------------------------------------------------------------ */

function VerdictRow({ verdict }: { verdict: DesignVerdict }) {
  const tone = verdictTone(verdict);
  const evidence = evidenceText(verdict);

  return (
    <li className={`border-l-2 pl-3 ${tone.rule}`}>
      <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-[0.68rem] tracking-wide uppercase">
        {/*
          The basis, spelled out. The mark is decorative — the word beside it is
          what a screen reader and a monochrome print both get.
        */}
        <span className={`rounded-[3px] px-1.5 py-0.5 ${tone.chip}`}>
          <span aria-hidden="true">{tone.mark} </span>
          {verdict.basis}
        </span>
        <span className={tone.outcome}>{verdict.outcome}</span>
      </p>

      <p className="mt-1.5">{verdict.criterion}</p>

      {evidence && (
        <p className="mt-1 flex flex-col gap-0.5">
          {/*
            Labelled differently on purpose. For a check this is the measurement
            it made; for an opinion it is a description of a picture, and
            calling both "evidence" without saying whose would blur the line the
            rest of this row exists to draw.
          */}
          <span className="text-ink-faint font-mono text-[0.65rem] tracking-wide uppercase">
            {tone.evidenceLabel}
          </span>
          <span className="text-ink-dim text-[0.84rem]">{evidence}</span>
        </p>
      )}

      <p className={`mt-1 text-[0.8rem] ${tone.clauseTone}`}>{tone.clause}</p>

      {verdict.conflict && (
        <div className="border-hairline-bright mt-2 rounded-[var(--radius-block)] border border-dashed p-2">
          <p className="text-ink-dim font-mono text-[0.65rem] tracking-wide uppercase">
            A model saw this differently
          </p>
          <p className="text-ink-dim mt-0.5 text-[0.82rem]">{verdict.conflict}</p>
        </div>
      )}
    </li>
  );
}

interface VerdictTone {
  /** Shape and weight of the rule down the left of the row. */
  rule: string;
  chip: string;
  outcome: string;
  /** Decorative only; the basis word next to it carries the meaning. */
  mark: string;
  evidenceLabel: string;
  clause: string;
  clauseTone: string;
}

/**
 * How each basis is drawn, and what it is worth in words.
 *
 * The rule's style is the load-bearing part: solid is measured, dashed is
 * claimed, dotted is absent. A row's colour only ever reinforces that, and no
 * row that is not `deterministic` is ever green.
 */
function verdictTone(verdict: DesignVerdict): VerdictTone {
  switch (verdict.basis) {
    case 'deterministic':
      return verdict.outcome === 'met'
        ? {
            rule: 'border-solid border-affirm',
            chip: 'border border-solid border-affirm/40 bg-affirm/10 text-affirm',
            outcome: 'text-affirm',
            mark: '✓',
            evidenceLabel: 'measured',
            clause:
              'A host check settled this, and the numbers it used are printed with it. This is the only kind of "met" that carries evidence.',
            clauseTone: 'text-ink-dim',
          }
        : {
            rule: 'border-solid border-caution',
            chip: 'border border-solid border-caution/40 bg-caution/10 text-caution',
            outcome: 'text-caution',
            mark: '✕',
            evidenceLabel: 'measured',
            clause:
              'A host check rejected this. The fix is in the measurement, not in the wording of the criterion.',
            clauseTone: 'text-ink-dim',
          };

    case 'opinion-only':
      return {
        rule: 'border-dashed border-hairline-bright',
        chip: 'border border-dashed border-hairline-bright text-ink-dim',
        outcome: 'text-ink-dim',
        mark: '~',
        evidenceLabel: 'the model said',
        clause:
          verdict.outcome === 'met'
            ? 'Only a model says met. Nothing checked it, so this is a lead rather than a result.'
            : verdict.outcome === 'not-met'
              ? 'A model reports this is not met. No check confirms it, so nothing is settled either way.'
              : 'A model looked and could not settle it either.',
        clauseTone: 'text-ink-dim',
      };

    default:
      return {
        rule: 'border-dotted border-hairline',
        chip: 'text-ink-faint',
        outcome: 'text-ink-faint',
        mark: '—',
        evidenceLabel: 'nothing measured',
        clause: 'Nobody settled this. It is not a pass, and it must not be reported as one.',
        clauseTone: 'text-ink-faint',
      };
  }
}

/**
 * The line to show under a criterion: the flattened one where the Worker sent
 * one, otherwise the finding the basis says settled it.
 */
function evidenceText(verdict: DesignVerdict): string {
  if (verdict.evidence) return verdict.evidence;
  if (verdict.basis === 'opinion-only') return verdict.opinion?.evidence ?? '';
  return verdict.verified?.evidence ?? verdict.opinion?.evidence ?? '';
}

/* ------------------------------------------------------------------ */
/* The tallies                                                         */
/* ------------------------------------------------------------------ */

/**
 * Four readings, never a partition.
 *
 * In the Worker these are counted on four separate rules and deliberately
 * overlap: `notMet` counts every rejection whichever track produced it, and a
 * criterion answered only by opinion that the model left unsettled is in both
 * `opinionOnly` and `unverifiable`. Drawn as a single bar or a percentage they
 * would imply a whole they do not add up to, so they are drawn as four
 * numbers, and the sentence under them says so.
 */
function Counts({ counts }: { counts: DesignReview['counts'] }) {
  return (
    <section aria-label="Counts" className="border-hairline flex flex-col gap-1.5 border-t pt-3">
      <h3 className={HEADING}>Counts</h3>
      <dl className="flex flex-wrap gap-x-6 gap-y-1.5 font-mono text-[0.72rem]">
        <Reading label="met by a check" value={counts.verifiedMet} tone="text-affirm" />
        <Reading label="not met" value={counts.notMet} tone="text-caution" />
        <Reading label="answered only by a model" value={counts.opinionOnly} tone="text-ink-dim" />
        <Reading label="settled by nobody" value={counts.unverifiable} tone="text-ink-faint" />
      </dl>
      <p className="text-ink-faint text-[0.78rem]">
        Counted on four separate rules, so they overlap and do not add up to the number of criteria.
      </p>
    </section>
  );
}

function Reading({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-ink-faint">{label}</dt>
      <dd className={tone}>{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The bytes                                                           */
/* ------------------------------------------------------------------ */

function MeshRow({ file, state }: { file: string; state: BytesState }) {
  return (
    <div className="border-hairline flex flex-col gap-1.5 border-t pt-3">
      <h4 className={HEADING}>The mesh</h4>
      {/*
        Said plainly, because the alternative is a reader assuming an
        interactive model is behind the button. There is no 3D library in this
        project and no viewer in this interface, so the file is the deliverable
        and the honest framing is "here it is, nothing here draws it".
      */}
      <p className="text-ink-dim text-[0.82rem]">
        A scene compiles to a mesh, and this is the mesh: a binary GLB, the form every other 3D
        tool takes. Nothing in this interface can draw one, so it is offered as a file rather than
        as a view. There is no 3D viewer here.
      </p>

      {state.status === 'ready' ? (
        <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-[0.72rem]">
          <span className="text-ink-faint">
            {file} · {formatBytes(state.bytes)}
          </span>
          <a
            href={state.url}
            download={file}
            className="text-signal decoration-signal-dim underline underline-offset-2"
          >
            Download the mesh
          </a>
        </p>
      ) : state.status === 'loading' ? (
        <p className="text-ink-faint font-mono text-[0.72rem]">Fetching {file}</p>
      ) : state.status === 'absent' ? (
        <p className="text-ink-faint text-[0.82rem]">{file} is not available in this session.</p>
      ) : (
        <p className="text-caution text-[0.82rem]">{state.message}</p>
      )}
    </div>
  );
}

type BytesState =
  | { status: 'loading' }
  | { status: 'ready'; url: string; bytes: number }
  | { status: 'absent' }
  | { status: 'failed'; message: string };

/**
 * Fetches one stored file and holds it as an object URL.
 *
 * Not a plain `<img src>`: every response from the byte route is
 * `Cache-Control: private, no-store` and scoped to this session, so the bytes
 * are fetched with credentials and kept in memory for exactly as long as the
 * picture is on screen. The URL is revoked in the effect's own cleanup, which
 * is also what keeps switching views from leaking one per view.
 *
 * A 404 is the route's ordinary answer — for a key that is another session's
 * and for one that has expired alike — so it renders as "not available" rather
 * than as a crash or an error.
 */
function useStoredBytes(url: string | null): BytesState {
  const [state, setState] = useState<BytesState>({ status: 'loading' });

  useEffect(() => {
    if (!url) {
      setState({ status: 'absent' });
      return;
    }

    const controller = new AbortController();
    let live = true;
    let created: string | null = null;
    setState({ status: 'loading' });

    void (async () => {
      try {
        const res = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
        if (!live) return;

        if (res.status === 404) {
          setState({ status: 'absent' });
          return;
        }
        if (!res.ok) {
          setState({ status: 'failed', message: await failureMessage(res) });
          return;
        }

        const blob = await res.blob();
        if (!live) return;
        created = URL.createObjectURL(blob);
        setState({ status: 'ready', url: created, bytes: blob.size });
      } catch (err) {
        // An abort is this effect being replaced by the next one, not a fault.
        if (!live) return;
        setState({
          status: 'failed',
          message: err instanceof Error ? err.message : 'That render could not be fetched.',
        });
      }
    })();

    return () => {
      live = false;
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  return state;
}

async function failureMessage(res: Response): Promise<string> {
  try {
    const detail = (await res.json()) as { message?: string };
    if (detail.message) return detail.message;
  } catch {
    /* Not JSON, so the status is all there is to report. */
  }
  return `The byte route answered ${res.status}.`;
}

/**
 * A URL for the byte route, from the three things it rebuilds a key from.
 *
 * `file` is the *last segment* of a stored key and not the key: the route
 * rebuilds `design/<lab>/<revision>/<file>` itself and checks it against this
 * session's own rows, so the key path never travels from here.
 */
function renderUrl(labId: string, revisionId: string, file: string): string {
  const path = [labId, revisionId].map(encodeURIComponent).join('/');
  return `/api/design/${path}/renders/${encodeURIComponent(file)}`;
}

function fileName(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1);
}

/* ------------------------------------------------------------------ */
/* Small shared bits                                                   */
/* ------------------------------------------------------------------ */

/** The house label style, matching the Inspector's. */
const HEADING = 'text-ink-faint font-mono text-[0.68rem] tracking-wide uppercase';

/** The contact sheet first, then the standard views in the order they are taken. */
const VIEW_ORDER = ['sheet', 'front', 'right', 'top', 'iso', 'canvas'];

function orderedViews(renderKeys: Record<string, string>): { view: string; file: string }[] {
  return Object.entries(renderKeys)
    .map(([view, key]) => ({ view, file: fileName(key) }))
    // A key with nothing after its last slash names no file, and the route
    // would refuse it. Dropping it here is quieter than asking and being told.
    .filter((entry) => entry.file !== '')
    .sort((a, b) => rank(a.view) - rank(b.view) || a.view.localeCompare(b.view));
}

function rank(view: string): number {
  const index = VIEW_ORDER.indexOf(view);
  return index === -1 ? VIEW_ORDER.length : index;
}

function viewNote(view: string): string {
  switch (view) {
    case 'sheet':
      return 'every view together';
    case 'front':
      return 'from the front';
    case 'right':
      return 'from the right';
    case 'top':
      return 'from above';
    case 'iso':
      return 'isometric';
    case 'canvas':
      return 'the drawing, rasterised';
    default:
      return view;
  }
}

/**
 * What the picture is, for someone who cannot see it. A render with no
 * description is unusable to a reader using a screen reader, and this one can
 * at least say which view it is a view from.
 */
function altText(surface: Surface, view: string): string {
  return view === 'sheet'
    ? `The ${surface} revision: every rendered view, side by side.`
    : `The ${surface} revision, rendered ${viewNote(view)}.`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} kB` : `${(kb / 1024).toFixed(1)} MB`;
}
