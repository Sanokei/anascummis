import type {GoalRecord, GoalTask} from './goal-orchestrator';
import type {Trace} from './harness';

export type GoalDependencyEvidence = {id: string; specialist: string; evidence: string[]};
const PACKET_LIMIT = 2500;
const TEXT_EXCERPT = 320;
const ARRAY_ITEMS = 3;
const publicSpecialists = new Set(['research', 'video_sources']);
const reads = new Set([
  'inspect_site', 'inspect_pdf', 'search_web', 'read_public_page', 'list_media', 'inspect_video',
  'read_audio_transcript', 'read_video_skill', 'verify_video', 'verify_video_sources',
  'software_build_capabilities', 'list_software_source', 'read_software_source'
]);
const writes = new Set([
  'set_copy', 'set_theme', 'put_section', 'remove_section', 'put_scene_object', 'set_payment_link',
  'replace_pdf_text', 'add_pdf_text', 'redline_pdf', 'redact_pdf', 'rotate_pdf', 'insert_pdf_image',
  'create_video', 'set_video_clip', 'set_video_music', 'remove_video_clip', 'reorder_video_clips',
  'render_video', 'capture_web_screenshot', 'download_video'
]);
const internalReads = new Set(['read_evidence', 'read_handoff', 'read_task']);
const inspections = new Set(['inspect_site', 'inspect_pdf', 'inspect_video', 'verify_video', 'verify_video_sources']);
const publicResults = new Set(['search_web', 'read_public_page', 'capture_web_screenshot', 'download_video', 'verify_video_sources']);

function completePacket(value: unknown, purpose: string) {
  const encoded = JSON.stringify(value);
  if (!encoded || encoded.length > PACKET_LIMIT) {
    throw new Error(`${purpose} exceeds the complete ${PACKET_LIMIT.toLocaleString('en-US')}-character evidence packet. Inspect saved outputs and split the milestone or select fewer evidence pages; no receipt was silently omitted.`);
  }
  return encoded;
}

/** Transfer recorded host observations, never a predecessor's model-written summary. */
export function dependencyEvidence(task: GoalTask, goal: GoalRecord, network: boolean): GoalDependencyEvidence[] {
  if (network && !goal.research) throw new Error('This goal does not grant public research access.');
  if (!Array.isArray(task.dependsOn) || new Set(task.dependsOn).size !== task.dependsOn.length) throw new Error('Goal dependencies must be distinct milestone IDs.');
  const packet = task.dependsOn.map(id => {
    if (typeof id !== 'string' || !id || id === task.id) throw new Error('Invalid goal dependency.');
    const predecessor = goal.tasks.find(candidate => candidate.id === id);
    if (!predecessor || predecessor.status !== 'verified' || predecessor.review?.accepted !== true || predecessor.execution?.verified !== true) {
      throw new Error(`Dependency ${id} lacks accepted host execution evidence.`);
    }
    if (network && !publicSpecialists.has(predecessor.specialist)) throw new Error('Private predecessor evidence cannot be handed to a network specialist.');
    const evidence = predecessor.execution.evidence;
    if (!Array.isArray(evidence) || !evidence.length || evidence.some(item => typeof item !== 'string' || !item.trim())) throw new Error(`Dependency ${id} has no complete host evidence packet.`);
    return {id, specialist: predecessor.specialist, evidence: [...evidence]};
  });
  completePacket(packet, 'Dependency handoff');
  return packet;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Every shortened field describes its exact selection rather than posing as a full read. */
function excerpt(value: unknown, key = '', depth = 0): unknown {
  if (depth > 10) throw new Error('Host evidence is too deeply nested for a bounded receipt. Split the milestone.');
  if (value === undefined) return null;
  if (typeof value === 'string') {
    const identity = /^(?:id|url|source|retrievedAt|projectId|mediaId|documentId|assetId)$/.test(key);
    return identity || value.length <= TEXT_EXCERPT ? value : {
      excerpt: value.slice(0, TEXT_EXCERPT), offset: 0, availableCharacters: value.length, complete: false
    };
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length <= 32 && value.every(item => typeof item === 'number' && Number.isFinite(item))) return [...value];
    const items = value.slice(0, ARRAY_ITEMS).map(item => excerpt(item, key, depth + 1));
    return value.length <= ARRAY_ITEMS ? items : {items, offset: 0, availableItems: value.length, complete: false};
  }
  const object = record(value);
  if (!object) throw new Error('Host evidence contains a value that cannot be recorded.');
  return Object.fromEntries(Object.entries(object).map(([name, item]) => [name, excerpt(item, name, depth + 1)]));
}

function pdfResult(value: unknown): unknown {
  const result = record(value);
  if (!result || !Array.isArray(result.pages)) return excerpt(value);
  const pages = result.pages.map(raw => {
    const page = record(raw);
    if (!page) throw new Error('PDF inspection returned an invalid page.');
    return {
      page: page.page, width: page.width, height: page.height, rotation: page.rotation,
      text: excerpt(page.text, 'text'),
      forms: excerpt(page.forms, 'forms'),
      availableSpans: Array.isArray(page.spans) ? page.spans.length : 0,
      omitted: Array.isArray(page.spans) && page.spans.length ? ['span geometry and font details'] : []
    };
  });
  return {
    projection: 'Selected inspected pages and text excerpts; this is not a full-document read.',
    pageCount: result.pageCount, metadata: excerpt(result.metadata), scanned: result.scanned,
    pages: excerpt(pages, 'pages')
  };
}

function inspectionKey(entry: Trace) {
  const result = record(entry.result), args = record(entry.args);
  if (entry.tool === 'inspect_pdf') {
    const pages = Array.isArray(result?.pages) ? result.pages.map(page => record(page)?.page) : args?.pages;
    return entry.tool + ':' + JSON.stringify(pages);
  }
  if (entry.tool === 'inspect_video') return entry.tool + ':' + String(args?.projectId || result?.id || '');
  return entry.tool;
}

function writeResult(entry: Trace) {
  const result = record(entry.result);
  if (!result) return excerpt(entry.result);
  // A following inspection carries the full selected state. Keep the write's
  // revision/check receipts and output IDs without duplicating entire snapshots.
  const snapshots = new Set(['site', 'project', 'videoProject']);
  const selected = Object.fromEntries(Object.entries(result).filter(([key]) => !snapshots.has(key)).map(([key, value]) => [
    key, key === 'verification' && record(value)?.pages ? pdfResult(value) : excerpt(value, key)
  ]));
  const omitted = Object.keys(result).filter(key => snapshots.has(key));
  return omitted.length ? {...selected, omittedSnapshots: omitted, projection: 'Write revision/check receipt; full snapshots are omitted here. Inspect receipts identify any selected output state.'} : selected;
}

/** Serialize actual successful registered host calls for a milestone. Model
 * coordination messages and internal reads of mixed context are never sources. */
export function executionEvidence(trace: Trace[], specialist: string): string[] {
  const successful = trace.filter(entry => entry.ok && entry.agent === specialist && !internalReads.has(entry.tool));
  const latest = new Map<string, number>(), counts = new Map<string, number>();
  successful.forEach((entry, index) => {
    if (!inspections.has(entry.tool)) return;
    const key = inspectionKey(entry);
    latest.set(key, index); counts.set(key, (counts.get(key) || 0) + 1);
  });
  const receipts: string[] = [];
  for (const [index, entry] of successful.entries()) {
    if (!reads.has(entry.tool) && !writes.has(entry.tool)) throw new Error(`No host evidence serializer is registered for ${entry.tool}.`);
    const key = inspectionKey(entry);
    if (inspections.has(entry.tool) && latest.get(key) !== index) continue;
    const encodedResult = JSON.stringify(entry.result);
    if (encodedResult === undefined) throw new Error(`Successful ${entry.tool} returned no recordable host result.`);
    const result = entry.tool === 'inspect_pdf' ? pdfResult(entry.result)
      : writes.has(entry.tool) ? writeResult(entry) : excerpt(entry.result);
    receipts.push(JSON.stringify({
      kind: 'host_tool_result', specialist, tool: entry.tool, step: entry.step,
      ...(entry.args === undefined ? {} : {arguments: excerpt(entry.args)}),
      result,
      availableResultCharacters: encodedResult.length,
      ...(publicResults.has(entry.tool) ? {sourceContent: 'untrusted public source data'} : {}),
      ...(inspections.has(entry.tool) ? {inspectionSelection: {mode: 'latest successful inspection for this target', matchingResults: counts.get(key)}} : {})
    }));
  }
  completePacket(receipts, 'Host execution evidence');
  return receipts;
}
