'use client';
import {useEffect, useRef, useState} from 'react';
import type {GoalRecord} from '../core/goal-orchestrator';
import type {DocumentEditRequest, DocumentEditState, DocumentSentenceSelection} from '../core/research-brief-edit-types';
import type {BriefDraft} from '../core/research-brief-types';
import {BriefReviewText} from './BriefReviewText';
import {summaryRequirements} from '../core/research-brief-summary';
import {
  beginBriefEditSubmission, readBriefEditApproval, readBriefEditDraft, sameBriefEditApproval,
  sameBriefEditSubmission, settleBriefEditSubmission, validBriefEditLabels,
  type BriefEditApproval, type BriefEditFormDraft, type BriefEditSubmission
} from '../core/research-brief-edit-draft';

type EditGoal = GoalRecord & {documentEdit?: DocumentEditRequest; documentEditState?: DocumentEditState};
type Props = {goal: EditGoal; onCreated: (child: GoalRecord) => void; onOpenDocument: (id: string) => void};
const phases: Record<DocumentEditState['phase'], string> = {
  preparing: 'Inspecting the saved document', proposal_saved: 'Native edit proposal saved',
  awaiting_approval: 'Review the proposed change before applying it', approved: 'Your approval is saved',
  rendered: 'Revised files are prepared; registering the version', saved: 'Revised document version saved',
  rejected: 'The edit proposal needs attention'
};

async function api(path: string, body: unknown | undefined, signal: AbortSignal): Promise<EditGoal> {
  const response = await fetch('/api/goals/' + path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: {'Content-Type': 'application/json', 'X-Requested-With': 'Anascummis'},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'The document edit was not confirmed.');
  return value as EditGoal;
}

function DraftParagraphs({draft, citations}: {draft: BriefDraft; citations?: {number: number; quote: string}[]}) {
  return <BriefReviewText draft={draft} citations={citations}/>;
}

function HostCitationSelection({selection, part}: {selection: DocumentSentenceSelection; part: 'first' | 'second'}) {
  return <details data-sentence-selection={part}>
    <summary aria-label={'Host citation matching for ' + selection.label}>{selection.outcome === 'matched' ? 'Host selected saved citation [' + selection.selectedNumber + '] for ' + selection.label + '; inspect matching' : 'Host found no matching saved citation for ' + selection.label + '; inspect matching'}</summary>
    <p>The host ranks saved quotations by matching label terms before the local model writes. Matching can miss relevant evidence; it does not verify the source’s claims.</p>
    <p>{selection.method}</p>
    <p>Label terms: {selection.queryTerms.length ? selection.queryTerms.join(', ') : 'No usable matching terms.'}</p>
    {selection.selectedQuote !== undefined && <><h5>Selected saved quotation</h5><blockquote aria-label={'Selected saved quotation for ' + selection.label}>{selection.selectedQuote}</blockquote><small>Selected quote SHA-256 {selection.selectedQuoteSha256}</small></>}
    {selection.outcome === 'none' && <p>No quotation had a positive match. The sentence writer cannot continue from this label; preserve this request and create a new edit with a more precise label.</p>}
    <ol aria-label={'Ranked saved citation candidates for ' + selection.label}>{selection.candidates.map(candidate => <li key={candidate.order}>
      <p>Saved citation [{candidate.number}] · score {candidate.score} · original order {candidate.order}</p>
      <p>Matched terms: {candidate.matchedTerms.length ? candidate.matchedTerms.join(', ') : 'None'}</p>
      <small>Source snapshot {candidate.sourceId} · quote starts at text position {candidate.offset}</small><small>Text SHA-256 {candidate.textSha256}</small><small>Quote SHA-256 {candidate.quoteSha256}</small>
    </li>)}</ol>
    <details><summary>Host matching record JSON</summary><pre tabIndex={0} aria-label={'Host citation matching JSON for ' + selection.label}>{JSON.stringify(selection, null, 2)}</pre></details>
    <small>{selection.version}</small>
  </details>;
}

function SavedEdit({goal, onCreated, onOpenDocument}: Props) {
  const request = goal.documentEdit!, state = goal.documentEditState;
  const [pending, setPending] = useState<BriefEditApproval>(), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [checkedUnapplied, setCheckedUnapplied] = useState(false), [storageError, setStorageError] = useState(''), [loaded, setLoaded] = useState(false);
  const [unknownApproval, setUnknownApproval] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const current = useRef<BriefEditApproval | undefined>(undefined), active = useRef<AbortController | undefined>(undefined), mounted = useRef(true);
  const inspectButton = useRef<HTMLButtonElement>(null), notice = useRef<HTMLParagraphElement>(null);
  const reviewDialog = useRef<HTMLDialogElement>(null), reviewTrigger = useRef<HTMLButtonElement>(null), reviewHeading = useRef<HTMLHeadingElement>(null);
  const reviewInspect = useRef<HTMLButtonElement>(null), reviewNotice = useRef<HTMLParagraphElement>(null);
  const storageKey = 'anascummis.research-brief-edit-approval.v1.' + goal.id;
  useEffect(() => {
    mounted.current = true;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {const saved = readBriefEditApproval(raw); current.current = saved; setPending(saved); setMessage('An earlier Apply was not confirmed. Inspect this saved edit before applying anything again.');}
    } catch (error) {setUnknownApproval(true); setStorageError(String(error));}
    setLoaded(true);
    return () => {mounted.current = false; active.current?.abort();};
  }, [storageKey]);
  function savePending(next: BriefEditApproval | undefined) {
    current.current = next; setPending(next);
    try {if (next) localStorage.setItem(storageKey, JSON.stringify(next)); else localStorage.removeItem(storageKey); setStorageError('');}
    catch {setStorageError('This browser could not keep the Apply acknowledgement locally. The operation identity is still saved in this goal; inspect the saved edit after closing or reloading.');}
  }
  function openReview() {
    const dialog = reviewDialog.current;
    if (!dialog || !state?.proposal) return;
    if (!dialog.open) dialog.showModal();
    setReviewOpen(true);
    requestAnimationFrame(() => reviewHeading.current?.focus({preventScroll: true}));
  }
  function closeReview() {reviewDialog.current?.close();}
  function reviewClosed() {
    setReviewOpen(false);
    requestAnimationFrame(() => reviewTrigger.current?.focus({preventScroll: true}));
  }
  function focusInspect() {(reviewDialog.current?.open ? reviewInspect.current : inspectButton.current)?.focus();}
  function focusNotice() {(reviewDialog.current?.open ? reviewNotice.current : notice.current)?.focus();}
  function approved(saved: EditGoal, submitted: BriefEditApproval) {
    const next = saved.documentEditState;
    if (saved.id !== goal.id || next?.operationId !== submitted.operationId
      || next.approvedProposalSha256 !== submitted.proposalSha256) throw new Error('The saved edit does not confirm this exact proposal approval. Inspect it before sending anything again.');
    if (current.current && !sameBriefEditApproval(current.current, submitted)) throw new Error('The pending approval identity changed. Inspect it before continuing.');
    savePending(undefined); setCheckedUnapplied(false); setUnknownApproval(false);
    setMessage(next.phase === 'saved' && next.artifact ? 'The revised version is saved. No second edit was applied.' : 'Your exact proposal approval is saved. Rendering may continue; if work was interrupted, use Continue remaining work.');
    onCreated(saved);
    if (reviewDialog.current?.open) requestAnimationFrame(focusNotice);
  }
  async function apply(retry = false) {
    if (active.current || !state?.proposalSha256 || !loaded || unknownApproval) return;
    if (retry ? !checkedUnapplied || !current.current : !!current.current) return;
    const submitted = retry ? current.current! : {operationId: state.operationId, proposalSha256: state.proposalSha256};
    savePending(submitted); setCheckedUnapplied(false);
    const controller = new AbortController(); active.current = controller; setBusy(true); setMessage('Saving approval of this exact proposal before creating a document version…');
    try {
      const saved = await api(encodeURIComponent(goal.id) + '/document-edit/apply', submitted, controller.signal);
      if (mounted.current && !controller.signal.aborted) approved(saved, submitted);
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {setMessage('Apply was not confirmed. The proposal and operation identity are kept. Inspect the saved edit before retrying. ' + String(error)); requestAnimationFrame(focusInspect);}
    } finally {if (active.current === controller) {active.current = undefined; if (mounted.current) setBusy(false);}}
  }
  async function inspect() {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setMessage('Inspecting the saved edit. This only reads its status; it does not apply changes.');
    try {
      const saved = await api(encodeURIComponent(goal.id), undefined, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      const next = saved.documentEditState, submitted = current.current;
      if (!next || saved.id !== goal.id || saved.documentEdit?.requestKey !== request.requestKey || next.operationId !== state?.operationId) throw new Error('The saved edit identity does not match this window.');
      if (submitted && next.approvedProposalSha256 === submitted.proposalSha256) approved(saved, submitted);
      else {
        if (submitted && (next.proposalSha256 !== submitted.proposalSha256 || next.operationId !== submitted.operationId)) throw new Error('The saved proposal differs from the unconfirmed approval. No approval was retried.');
        setCheckedUnapplied(!!submitted && next.phase === 'awaiting_approval' && saved.status === 'needs_input');
        if (unknownApproval) {savePending(undefined); setUnknownApproval(false);}
        onCreated(saved);
        setMessage(next.approvedProposalSha256 ? 'The saved edit already has an approval. Continue unfinished work if needed; nothing was submitted.' : submitted && next.phase === 'awaiting_approval' && saved.status === 'needs_input' ? 'This exact proposal is still awaiting approval. You may explicitly retry Apply; no edit has been replayed.' : 'The saved edit was inspected. Nothing was applied. Use the visible recovery action if work is stopped or interrupted.');
      }
      requestAnimationFrame(focusNotice);
    } catch (error) {if (mounted.current && !controller.signal.aborted) {setCheckedUnapplied(false); setMessage('Could not confirm the saved edit. The pending identity is kept and nothing was resubmitted. ' + String(error));}}
    finally {if (active.current === controller) {active.current = undefined; if (mounted.current) setBusy(false);}}
  }
  const artifact = state?.phase === 'saved' ? state.artifact : undefined, base = '/api/goals/' + encodeURIComponent(goal.id) + '/document-edit';
  const original = '/api/goals/' + encodeURIComponent(request.originalBriefGoalId || request.parentGoalId) + '/brief';
  const baseFiles = '/api/goals/' + encodeURIComponent(request.parentGoalId) + (request.baseRevision === 0 ? '/brief' : '/document-edit');
  const canApply = state?.phase === 'awaiting_approval' && goal.status === 'needs_input' && !!state.proposalSha256 && !state.conflict;
  const grounded = state?.writingMode === 'grounded-labelled-sentences-v3';
  const rewrite = state?.writingMode === 'current-summary-rewrite-v4';
  const sequential = grounded || state?.writingMode === 'sequential-labelled-sentences-v2';
  const savedSentences = Number(!!state?.sentenceAttempts?.first) + Number(!!state?.sentenceAttempts?.second);
  const hasNativeWriting = !!state?.writingAttempt || savedSentences > 0;
  return <section className="research-brief-edit" aria-label="Research brief edit">
    <h4>Edit the research brief</h4>
    <p>{state ? state.phase === 'preparing' && sequential ? savedSentences === 1 ? 'First native sentence saved; the second is not yet saved' : savedSentences === 2 ? 'Both native sentences saved; preparing the proposal' : 'Preparing two native sentence-writing decisions' : phases[state.phase] : 'The exact edit request is saved. Waiting for the document specialist.'}</p>
    <section className="research-brief-edit-intent" aria-label="Requested change"><h5>Requested change</h5><p>{request.intent}</p>{request.sentenceLabels && <><p>Requested sentence labels: {request.sentenceLabels.join(' / ')}</p><small>The host adds these exact labels to two native-written factual sentences. The model supplies their content; the host does not add facts.</small></>}</section>
    {state?.conflict && <div className="research-brief-review-conflict" role="status"><strong>Base version {state.conflict.expectedRevision} changed to version {state.conflict.actualRevision}.</strong><p>{state.conflict.reason}</p><p>This proposal has not been applied to the newer version. Open the latest accepted edit before requesting another change.</p></div>}
    <small>This edit changes only the factual brief paragraph. The title, complete personal notes, accepted research and literal citation evidence are preserved. It is not an arbitrary PDF-layout edit.</small>
    {rewrite && <p>The local model rewrites the current accepted summary. Its original response is kept below; the host does not compose or replace factual sentences.</p>}
    {request.requirements && <p className="research-brief-review-requirements">Requested summary: {request.requirements.oneSentence ? 'one sentence; ' : ''}{request.requirements.shorterThanCharacters ? 'shorter than the current ' + request.requirements.shorterThanCharacters + ' characters; ' : ''}keep the exact saved locations and citation numbers.</p>}
    {sequential && <section aria-label="Native sentence progress">
      <p>{savedSentences} of 2 native sentence-writing decisions saved.</p>
      <small>First sentence: {state?.sentenceAttempts?.first ? state.sentenceAttempts.first.error ? 'saved; needs attention.' : 'saved.' : 'not saved.'} Second sentence: {state?.sentenceAttempts?.second ? state.sentenceAttempts.second.error ? 'saved; needs attention.' : 'saved.' : 'not saved.'}</small>
      {grounded ? <><small>Each sentence writer receives only its label and the one literal saved quotation selected by host word matching. It does not receive the full edit intent, original paragraph, accepted answer, other quotations or personal notes.</small><small>The separate support review receives the full edit intent, original paragraph, accepted answer and all literal quotations. The complete notes and provenance remain preserved by the host.</small></> : <small>Each sentence-writing call reads its target label, exact request, original factual paragraph, full accepted answer and all literal citation quotes. It does not receive the longer selected passages or your personal notes. The original sources and complete notes remain preserved.</small>}
    </section>}
    {grounded && state?.sentenceSelections && <section aria-label="Host sentence evidence selection">{(['first', 'second'] as const).map(part => state.sentenceSelections?.[part] ? <HostCitationSelection key={part} part={part} selection={state.sentenceSelections[part]!}/> : null)}</section>}
    {(pending || unknownApproval) && <div hidden={reviewOpen} className="research-brief-edit-notice" aria-label="Unconfirmed edit approval">
      <p>Apply needs inspection before another approval. Opening or reloading this window does not replay it.</p>
      <button ref={inspectButton} type="button" disabled={busy || !loaded} onClick={() => void inspect()}>Inspect saved edit</button>
      {checkedUnapplied && canApply && <button type="button" disabled={busy} onClick={() => void apply(true)}>Retry applying inspected proposal</button>}
    </div>}
    {state?.proposal && <div className="research-brief-review-launch">
      <p><strong>Changed section: Summary.</strong> Version {request.baseRevision} → {artifact ? 'saved' : 'proposed'} version {request.baseRevision + 1}. Title, notes and evidence stay unchanged.</p>
      <button ref={reviewTrigger} type="button" onClick={openReview}>Review proposed change</button>
      <small>Open a wider review with readable source links. Exact raw text remains inspectable.</small>
    </div>}
    {state && <div className="research-brief-edit-comparison" aria-label="Proposed document changes">
      <section aria-label="Before edit"><h5>Before edit · version {request.baseRevision}</h5><DraftParagraphs draft={state.before} citations={state.preserved.citations}/></section>
      {state.proposal && <section aria-label="Proposed edit"><h5>Proposed edit · version {request.baseRevision + 1}</h5><DraftParagraphs draft={state.proposal} citations={state.preserved.citations}/></section>}
    </div>}
    {state?.draftCheck && <p>{state.draftCheck.accepted ? 'Host proposal checks passed: ' : 'Host proposal checks need attention: '}{state.draftCheck.reason}</p>}
    {state?.supportReview && <p>{state.supportReview.supported ? 'Native support review passed: ' : 'Native support review needs attention: '}{state.supportReview.reason}</p>}
    {state?.projection && <details><summary>Host sentence formatting</summary><p>{state.projection.method}</p><small>{sequential ? 'The two native responses remain unchanged and separately inspectable below, with an aggregate JSON copy. The host may remove one exact repeated label before adding your exact labels; it does not rewrite factual sentence content.' : 'The native response remains unchanged in the operation inspection below. The displayed proposal includes your exact requested labels.'}</small><small>{state.projection.version}</small><small>{sequential ? 'Aggregate native response' : 'Native response'} SHA-256 {state.projection.rawSha256}</small><small>Proposed wording SHA-256 {state.projection.proposalSha256}</small></details>}
    {canApply && !pending && !unknownApproval && <div hidden={reviewOpen} className="research-brief-edit-approval">
      <p>Compare the wording above. Apply saves one revised version and uses the updated document presentation. The original files remain available below.</p>
      <button type="button" disabled={busy || !loaded} onClick={() => void apply()}>Apply proposed edit</button>
    </div>}
    {state?.proposal && <dialog ref={reviewDialog} className="research-brief-review-dialog" aria-labelledby={'brief-review-title-' + goal.id} aria-modal="true"
      onClose={reviewClosed} onCancel={event => {event.preventDefault(); closeReview();}} onKeyDown={event => event.stopPropagation()}>
      {reviewOpen && <>
      <header className="research-brief-review-header">
        <h2 ref={reviewHeading} id={'brief-review-title-' + goal.id} tabIndex={-1}>Review summary edit</h2>
        <p>Version {request.baseRevision} → {artifact ? 'saved' : 'proposed'} version {request.baseRevision + 1} · Changed section: Summary</p>
        <small>{state.preserved.title}. The complete notes, title and citation evidence stay unchanged.</small>
      </header>
      <div className="research-brief-review-scroll" role="region" aria-label="Summary comparison and evidence" tabIndex={0}>
        <section className="research-brief-review-request" aria-label="Review requested change"><h3>Requested change</h3><p>{request.intent}</p></section>
        {state.conflict && <div className="research-brief-review-conflict" role="status"><strong>Base version {state.conflict.expectedRevision} changed to version {state.conflict.actualRevision}.</strong><p>{state.conflict.reason}</p><p>No automatic rebase or Apply is performed. Inspect the latest accepted version before creating another request.</p></div>}
        {request.requirements && <p>Requested summary: {request.requirements.oneSentence ? 'one sentence; ' : ''}{request.requirements.shorterThanCharacters ? 'shorter than the current ' + request.requirements.shorterThanCharacters + ' characters; ' : ''}keep the exact saved locations and citation numbers.</p>}
        <p ref={reviewNotice} role="status" tabIndex={-1} hidden={!message}>{message}</p>
        <div className="research-brief-review-comparison" aria-label="Expanded proposed document changes">
          <section aria-label="Before summary"><h3>Before · version {request.baseRevision}</h3><DraftParagraphs draft={state.before} citations={state.preserved.citations}/></section>
          <section aria-label="Proposed summary"><h3>{artifact ? 'Saved' : 'Proposed'} · version {request.baseRevision + 1}</h3><DraftParagraphs draft={state.proposal} citations={state.preserved.citations}/></section>
        </div>
        <p className="research-brief-review-state">{phases[state.phase]}</p>
        {state.draftCheck && <p>{state.draftCheck.accepted ? 'Host checks passed. ' : 'Host checks need attention. '}{state.draftCheck.reason}</p>}
        {state.supportReview && <details><summary>Native support review</summary><p>{state.supportReview.supported ? 'The native role accepted this proposal. ' : 'The native role rejected this proposal. '}{state.supportReview.reason}</p><small>A model review does not independently verify factual accuracy.</small></details>}
        <details><summary>Exact raw comparison and citation evidence</summary>
          <pre tabIndex={0} aria-label="Raw before summary JSON">{JSON.stringify(state.before, null, 2)}</pre>
          <pre tabIndex={0} aria-label="Raw proposed summary JSON">{JSON.stringify(state.proposal, null, 2)}</pre>
          {state.preserved.citations.map(citation => <blockquote key={citation.number}>[{citation.number}] {citation.quote}</blockquote>)}
          {state.writingAttempt && <pre tabIndex={0} aria-label="Raw native edit decision JSON">{JSON.stringify(state.writingAttempt.raw, null, 2)}</pre>}
        </details>
        <p><a href={baseFiles + '/export?format=pdf'} download>Download base version {request.baseRevision} PDF</a> · <a href={baseFiles + '/export?format=html'} download>Download base version {request.baseRevision} HTML</a></p>
      </div>
      <footer className="research-brief-review-footer">
        <p>{state.conflict ? 'The base changed. Close review and inspect the latest version.' : pending || unknownApproval ? 'Apply needs inspection. Nothing is replayed.' : canApply ? 'Apply creates one version. Cancel review keeps the proposal.' : state.approvedProposalSha256 ? 'Approval is saved. Close review to return to the goal.' : 'Review only. Opening or closing does not apply a change.'}</p>
        <div className="research-brief-review-buttons">
          {(pending || unknownApproval) ? <><button ref={reviewInspect} type="button" disabled={busy || !loaded} onClick={() => void inspect()}>Inspect saved edit</button>{checkedUnapplied && canApply && <button type="button" disabled={busy} onClick={() => void apply(true)}>Retry applying inspected proposal</button>}</> : canApply && <button type="button" disabled={busy || !loaded} onClick={() => void apply()}>Apply proposed edit</button>}
          <button type="button" onClick={closeReview}>Cancel review</button>
        </div>
      </footer>
      </>}
    </dialog>}
    {state?.phase === 'rejected' && <p role="status">This proposal has not passed the checks. {hasNativeWriting ? 'Its saved native responses are kept below.' : 'No native writing decision has been saved.'} Continuing does not silently generate a replacement; start a separate edit from the latest accepted document version for a different request.</p>}
    {state?.phase === 'rendered' && <p role="status">The prepared files are not yet registered as a document version. If work was interrupted, use Continue remaining work. Opening this window does not publish or replay the edit.</p>}
    {artifact && <>
      <p>Version {artifact.revision} · {artifact.pages} {artifact.pages === 1 ? 'page' : 'pages'} · {goal.status === 'completed' ? 'Revised files and goal checks passed.' : 'Version saved; goal acceptance is shown above.'}</p>
      <div className="goal-actions research-brief-actions">
        <button type="button" onClick={() => onOpenDocument(artifact.documentId)}>Open revised PDF</button>
        <a href={base + '/preview'} target="_blank" rel="noopener noreferrer">Open revised HTML</a>
        <a href={base + '/export?format=pdf'} download>Download revised PDF</a>
        <a href={base + '/export?format=html'} download>Download revised HTML</a>
        <a href={base + '/provenance?format=html'} target="_blank" rel="noopener noreferrer">Inspect edit provenance</a>
        <a href={base + '/provenance?format=json'} download>Download edit provenance</a>
      </div>
      <small>The PDF editor opens the latest document version. These revised downloads and the HTML preview retain version {artifact.revision}, even after later manual edits.</small>
    </>}
    <details className="research-brief-edit-preserved"><summary>Preserved notes, citations and original files</summary>
      {state && <><h5>{state.preserved.title}</h5><p className="research-brief-notes">{state.preserved.notes || 'No personal notes were supplied.'}</p>
        {state.preserved.citations.map(citation => <blockquote key={citation.number}>[{citation.number}] {citation.quote}</blockquote>)}</>}
      <div className="goal-actions research-brief-actions"><a href={original + '/export?format=pdf'} download>Download original PDF</a><a href={original + '/export?format=html'} download>Download original HTML</a></div>
      <small>These downloads retain the original accepted files. Revised downloads use this edit’s fixed version.</small>
    </details>
    {state && <details><summary>Edit operation and native decision</summary>
      <small>Operation {state.operationId}</small><small>Document {request.documentId} · base version {request.baseRevision}</small>
      <small>Input SHA-256 {state.inputSha256}</small><small>Base version {request.baseRevision} PDF SHA-256 {request.basePdfSha256}</small>
      {request.inferenceProfile && <details><summary>Native rewrite profile</summary><p>This saved profile describes the actual local rewrite request. It is not a factual-accuracy guarantee.</p><pre tabIndex={0} aria-label="Native rewrite profile JSON">{JSON.stringify(request.inferenceProfile, null, 2)}</pre></details>}
      {state.proposalSha256 && <small>Proposed wording SHA-256 {state.proposalSha256}</small>}
      {state.approvedProposalSha256 && <small>Approved wording SHA-256 {state.approvedProposalSha256}</small>}
      {artifact && <><small>Revised PDF SHA-256 {artifact.pdfSha256}</small><small>Revised HTML SHA-256 {artifact.htmlSha256}</small><small>Provenance SHA-256 {artifact.provenanceSha256}</small></>}
      {state.sentenceAttempts && <section aria-label="Saved native sentence decisions">
        {(['first', 'second'] as const).map((part, index) => {
          const attempt = state.sentenceAttempts?.[part], label = index === 0 ? 'First' : 'Second';
          return attempt ? <section key={part}><h5>{label} sentence decision{request.sentenceLabels ? ': ' + request.sentenceLabels[index] : ''}</h5><small>{label} sentence decision SHA-256 {attempt.sha256}</small>{attempt.error && <p>{attempt.error}</p>}<pre tabIndex={0} aria-label={label + ' native sentence decision JSON'}>{JSON.stringify(attempt.raw, null, 2)}</pre></section> : <p key={part}>{label} native sentence decision has not been saved.</p>;
        })}
      </section>}
      {state.writingAttempt && <><small>{sequential ? 'Aggregate decision' : 'Native decision'} SHA-256 {state.writingAttempt.sha256}</small>
        {sequential && <small>This aggregate JSON combines two saved native sentence decisions. Their individual original responses and identities are shown above.</small>}
        {state.writingAttempt.error && <p>{state.writingAttempt.error}</p>}
        <pre tabIndex={0} aria-label="Original native edit decision JSON">{JSON.stringify(state.writingAttempt.raw, null, 2)}</pre></>}
      <small>A native support review is bounded model evidence; it does not independently verify the source’s claims.</small>
    </details>}
    {storageError && <p role="status">{storageError}</p>}
    <p ref={notice} hidden={reviewOpen} role="status" tabIndex={-1}>{message}</p>
  </section>;
}

function EditCreation({goal, onCreated}: Props) {
  const [draft, setDraft] = useState<BriefEditFormDraft>(), [open, setOpen] = useState(false), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [storageError, setStorageError] = useState(''), [checkedMissing, setCheckedMissing] = useState(false);
  const [unreadable, setUnreadable] = useState<{raw: string; backupKey?: string}>(), [restoreFailed, setRestoreFailed] = useState(false);
  const current = useRef<BriefEditFormDraft | undefined>(undefined), active = useRef<AbortController | undefined>(undefined), mounted = useRef(true);
  const intentInput = useRef<HTMLTextAreaElement>(null), inspectButton = useRef<HTMLButtonElement>(null), notice = useRef<HTMLParagraphElement>(null);
  const storageKey = 'anascummis.research-brief-edit-draft.v1.' + goal.id;
  const unavailable = goal.briefEditEligibility?.canEdit === false;
  const currentVersion = !!goal.documentEdit;
  const unavailableReason = goal.briefEditEligibility?.reason || 'This action needs the accepted current document version. Open the latest linked edit goal before requesting another change.';
  const sourceRevision = goal.documentEditState?.artifact?.revision ?? 0;
  useEffect(() => {
    mounted.current = true;
    let raw: string | null = null;
    try {raw = localStorage.getItem(storageKey); if (raw) {const saved = readBriefEditDraft(raw); current.current = saved; setDraft(saved); setOpen(true); if (saved.submitted) setMessage('An earlier edit submission was not confirmed. Inspect saved edits before sending again.');}}
    catch (error) {if (raw !== null) setUnreadable({raw}); setRestoreFailed(true); setStorageError('This browser could not restore the edit draft. Its stored copy has not been replaced. Inspect the raw text below or the saved goal. ' + String(error));}
    setLoaded(true);
    return () => {mounted.current = false; active.current?.abort();};
  }, [storageKey]);
  function save(next: BriefEditFormDraft | undefined) {
    current.current = next; setDraft(next);
    try {if (next) localStorage.setItem(storageKey, JSON.stringify(next)); else localStorage.removeItem(storageKey); setStorageError('');}
    catch {setStorageError('This browser could not save the edit draft. Keep this window open or copy the request before closing or reloading.');}
  }
  function reveal() {
    if (restoreFailed && !unreadable) {setStorageError('This browser could not read its earlier draft. It has not been replaced. Keep this window open and inspect the saved goal before starting another draft.'); return;}
    if (unreadable && !unreadable.backupKey) {
      const backupKey = storageKey + '.unreadable.' + crypto.randomUUID();
      try {localStorage.setItem(backupKey, unreadable.raw); setUnreadable({...unreadable, backupKey});}
      catch {setStorageError('The unreadable draft could not be backed up. Its original stored copy has not been replaced. Copy its exact raw text below before using another browser.'); return;}
      setMessage('The unreadable draft was kept separately in this browser before starting a new edit draft. Nothing was submitted.');
    }
    if (!current.current) save({version: 1, requestKey: crypto.randomUUID(), intent: ''});
    setOpen(true); requestAnimationFrame(() => intentInput.current?.focus());
  }
  function sentenceMode(enabled: boolean) {
    const previous = current.current;
    if (!previous) return;
    const {sentenceLabels, labelDraft, ...rest} = previous, labels = sentenceLabels || labelDraft || ['', ''];
    save({...rest, ...(enabled ? {sentenceLabels: [labels[0], labels[1]] as [string, string]} : {labelDraft: [labels[0], labels[1]] as [string, string]})});
  }
  function editLabel(index: 0 | 1, value: string) {
    const previous = current.current;
    if (!previous?.sentenceLabels) return;
    const sentenceLabels: [string, string] = [...previous.sentenceLabels]; sentenceLabels[index] = value;
    save({...previous, sentenceLabels});
  }
  function confirmed(child: EditGoal, submitted: BriefEditSubmission) {
    if (child.parentGoalId !== goal.id || child.documentEdit?.parentGoalId !== goal.id || !sameBriefEditSubmission(child.documentEdit, submitted)) throw new Error('The saved edit does not match the exact requested change and submission identity.');
    if (!current.current) throw new Error('The pending edit draft is missing. Inspect saved goals before submitting again.');
    const next = settleBriefEditSubmission(current.current, submitted, () => crypto.randomUUID());
    save(next); setCheckedMissing(false); if (!next) setOpen(false);
    setMessage(next ? 'The submitted edit is saved. Your unsent requested change or sentence labels remain here as a separate browser draft.' : 'The exact requested change and format are saved in a linked edit goal. Review its proposal before applying.');
    onCreated(child);
  }
  async function submit(retry = false) {
    if (active.current || !current.current || unavailable) return;
    let saved = current.current;
    if (currentVersion) {
      const candidate = retry ? saved.submitted : saved, before = goal.documentEditState?.proposal;
      if (!candidate || candidate.sentenceLabels) {setMessage('This current-version action supports shortening the summary to one sentence. Your saved labels and request are kept; turn off the two-label format before sending. Nothing was submitted.'); requestAnimationFrame(() => notice.current?.focus()); return;}
      const requirements = before && summaryRequirements(candidate.intent, before);
      if (!requirements?.oneSentence || !requirements.shorterThanCharacters) {setMessage('This current-version action supports an explicit request to shorten the summary to one sentence. Your exact draft is kept; nothing was submitted.'); requestAnimationFrame(() => notice.current?.focus()); return;}
    }
    try {if (!retry) {saved = beginBriefEditSubmission(saved); save(saved);} else if (!checkedMissing || !saved.submitted) return;}
    catch (error) {setMessage(String(error)); return;}
    const submitted = saved.submitted!, controller = new AbortController(); active.current = controller; setBusy(true); setCheckedMissing(false); setMessage('Saving the exact requested change before native proposal…');
    try {
      const child = await api(encodeURIComponent(goal.id) + '/document-edit', submitted, controller.signal);
      if (mounted.current && !controller.signal.aborted) confirmed(child, submitted);
    } catch (error) {if (mounted.current && !controller.signal.aborted) {setMessage('Edit submission was not confirmed. The exact request and submission identity are kept. Inspect saved edits before retrying. ' + String(error)); requestAnimationFrame(() => inspectButton.current?.focus());}}
    finally {if (active.current === controller) {active.current = undefined; if (mounted.current) setBusy(false);}}
  }
  async function inspect() {
    const submitted = current.current?.submitted;
    if (active.current || !submitted) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setMessage('Inspecting saved edit goals. No edit is being submitted.');
    try {
      const response = await fetch('/api/goals', {credentials: 'same-origin', cache: 'no-store', signal: controller.signal}), values: unknown = await response.json();
      if (!mounted.current || controller.signal.aborted) return;
      if (!response.ok || !Array.isArray(values)) throw new Error('Saved edit goals are unavailable.');
      const matches = (values as EditGoal[]).filter(child => child.documentEdit?.parentGoalId === goal.id && child.documentEdit.requestKey === submitted.requestKey);
      if (matches.length > 1) throw new Error('More than one edit has this submission identity. Review saved goals before continuing.');
      if (matches[0]) confirmed(matches[0], submitted);
      else {setCheckedMissing(true); setMessage('No edit with this submission identity is saved. You may explicitly retry the original requested change. Newer edits remain separate.'); requestAnimationFrame(() => notice.current?.focus());}
    } catch (error) {if (mounted.current && !controller.signal.aborted) {setCheckedMissing(false); setMessage('Could not inspect saved edits. The request is kept and nothing was resubmitted. ' + String(error));}}
    finally {if (active.current === controller) {active.current = undefined; if (mounted.current) setBusy(false);}}
  }
  return <section className="research-brief-edit-create" aria-label="Edit a research brief">
    {!open && <button type="button" disabled={!loaded || (unavailable && !draft)} onClick={reveal}>{unreadable && !unreadable.backupKey ? 'Keep unreadable draft and start new edit' : draft ? 'Continue edit draft' : goal.documentEdit ? 'Edit current brief' : 'Edit brief'}</button>}
    {unreadable && <details><summary>Unreadable saved edit draft</summary><p>This exact browser copy is kept for inspection. Check the linked goals for any earlier submission before sending new work.</p><pre tabIndex={0} aria-label="Unreadable saved edit draft raw text">{unreadable.raw}</pre>{unreadable.backupKey && <small>Kept in browser storage as {unreadable.backupKey}</small>}</details>}
    {unavailable && <div role="status"><p>{unavailableReason}</p><small>Any saved request remains in this browser. Open the latest accepted edit goal to inspect the current version before starting another edit.</small></div>}
    {open && draft && <form onSubmit={event => {event.preventDefault(); void submit();}}>
      <h4>Request a factual paragraph edit</h4>
      <p>Editing accepted version {sourceRevision}; the proposal will create version {sourceRevision + 1}. The local AI proposes a change to the summary. Review the before/after wording before applying it. Complete notes and citation evidence remain unchanged.</p>
      {currentVersion && <p>This current-version action supports shortening the summary to one sentence. Exact notes, locations and citation evidence stay unchanged.</p>}
      <label>Requested brief change<textarea ref={intentInput} aria-label="Requested brief change" value={draft.intent} maxLength={500} onChange={event => {if (current.current) save({...current.current, intent: event.target.value});}} placeholder="Describe the specific paragraph change you want."/></label>
      <small>Up to 500 characters. This request stays in this browser until you explicitly save it. The accepted current summary is the base; earlier versions remain available. Imported PDF layouts and arbitrary page edits are outside this action’s scope.</small>
      {!currentVersion ? <fieldset className="research-brief-edit-format"><legend>Optional sentence format</legend>
        <label className="goal-option"><input type="checkbox" aria-label="Two labelled sentences" checked={!!draft.sentenceLabels} onChange={event => sentenceMode(event.target.checked)}/>Two labelled sentences</label>
        <label>First sentence label<input aria-label="First sentence label" value={(draft.sentenceLabels || draft.labelDraft)?.[0] || ''} maxLength={32} disabled={!draft.sentenceLabels} onChange={event => editLabel(0, event.target.value)} placeholder="Tests:"/></label>
        <label>Second sentence label<input aria-label="Second sentence label" value={(draft.sentenceLabels || draft.labelDraft)?.[1] || ''} maxLength={32} disabled={!draft.sentenceLabels} onChange={event => editLabel(1, event.target.value)} placeholder="Browser results:"/></label>
        <small>When checked, the local model writes two factual sentences and the host adds your labels exactly. Labels stay in this browser when unchecked and are not sent with a free-prose request.</small>
        {draft.sentenceLabels && !validBriefEditLabels(draft.sentenceLabels) && <p role="status">Enter two different nonempty sentence labels, at most 32 characters each, without leading or trailing spaces.</p>}
      </fieldset> : draft.sentenceLabels ? <div className="research-brief-edit-notice"><p>The saved two-label draft is kept, but this current-summary rewrite supports one sentence.</p><pre aria-label="Kept sentence labels JSON">{JSON.stringify(draft.sentenceLabels)}</pre><button type="button" onClick={() => sentenceMode(false)}>Keep labels aside and use one sentence</button></div> : draft.labelDraft?.some(label => label.length) ? <details><summary>Kept inactive sentence labels</summary><pre>{JSON.stringify(draft.labelDraft)}</pre><small>These labels stay in the browser draft and are not submitted for the one-sentence rewrite.</small></details> : null}
      {draft.submitted && <div className="research-brief-edit-notice" aria-label="Unconfirmed edit submission">
        <p>The original submission needs inspection. Any newer wording above is kept as a separate unsent draft.</p>
        <details><summary>Original submitted change</summary><p>{draft.submitted.intent}</p>{draft.submitted.sentenceLabels && <p>Submitted sentence labels: {draft.submitted.sentenceLabels.join(' / ')}</p>}<small>Submission {draft.submitted.requestKey}</small></details>
        <button ref={inspectButton} type="button" disabled={busy} onClick={() => void inspect()}>Inspect saved edits</button>
        {checkedMissing && <button type="button" disabled={busy || unavailable} onClick={() => void submit(true)}>Retry saved edit submission</button>}
      </div>}
      <div className="goal-actions research-brief-actions"><button type="submit" disabled={busy || unavailable || !!draft.submitted || !draft.intent.trim() || (!!draft.sentenceLabels && !validBriefEditLabels(draft.sentenceLabels))}>Save edit and propose changes</button><button type="button" onClick={() => setOpen(false)}>Close edit form</button></div>
    </form>}
    {storageError && <p role="status">{storageError}</p>}
    <p ref={notice} role="status" tabIndex={-1}>{message}</p>
  </section>;
}

export function ResearchBriefEdit(props: Props) {
  if (props.goal.documentEdit) return <><SavedEdit {...props}/>{props.goal.status === 'completed' && props.goal.documentEditState?.phase === 'saved' && props.goal.documentEditState.artifact && <EditCreation {...props}/>}</>;
  if (props.goal.brief && props.goal.status === 'completed' && props.goal.briefState?.artifact) return <EditCreation {...props}/>;
  return null;
}
