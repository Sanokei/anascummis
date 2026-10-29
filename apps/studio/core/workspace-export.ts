export type ExportTarget = 'website' | 'pdf' | 'video';
export type ExportFormat = 'html' | 'zip' | 'pdf' | 'png' | 'mp4';

/** Preserve what the user asked to export independently of the open attachment. */
export function exportRequest(command: string): {target?: ExportTarget; format?: ExportFormat} | undefined {
  const match = /^(?:please )?(?:export|download)(?: (?:the |my )?(website|site|pdf|file|video))?(?: as (png|pdf|html|zip|mp4))?$/.exec(command);
  if (!match) return;
  const target = match[1] === 'site' ? 'website' : match[1] === 'file' ? undefined : match[1];
  return {target: target as ExportTarget | undefined, format: match[2] as ExportFormat | undefined};
}

export function resolveExport(format: string, target: ExportTarget | undefined, context: {pdf: boolean; video: boolean; preview?: string | null}): {target: ExportTarget; format: ExportFormat} {
  const implied = ['html', 'zip'].includes(format) ? 'website' : ['pdf', 'png'].includes(format) ? 'pdf' : format === 'mp4' ? 'video' : undefined;
  if (format && !implied) throw new Error('Choose HTML or ZIP for a website, PDF or PNG for a PDF, or MP4 for a finished video.');
  const selected = target || implied || (context.preview === 'website' ? 'website' : context.preview === 'pdf' ? 'pdf' : context.preview === 'video' ? 'video' : context.pdf ? 'pdf' : 'website');
  if (implied && implied !== selected) throw new Error('That format does not match the requested file. Use HTML or ZIP for the website, PDF or PNG for a PDF, or MP4 for a video.');
  if (selected === 'pdf' && !context.pdf) throw new Error('Open a PDF before exporting it. No file was exported.');
  if (selected === 'video' && !context.video) throw new Error('Create a finished video before exporting MP4. No file was exported.');
  return {target: selected, format: (format || (selected === 'website' ? 'zip' : selected === 'video' ? 'mp4' : 'pdf')) as ExportFormat};
}
