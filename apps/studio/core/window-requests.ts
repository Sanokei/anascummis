/** Short window/status commands must consume the whole request. Feature words
 * inside a software goal must never replace saving that goal. */
function command(request:string){return request.trim().toLowerCase().replace(/\s+/g,' ').replace(/[.!?]+$/,'').replace(/^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?/,'');}
const subject="(?:(?:my|the|this|current|latest|last)\\s+)?(?:software(?:\\s+build)?|application|app|build(?:\\s+task)?|task)";
const status='(?:status|progress|remaining\\s+time|time\\s+remaining)';
const statusPatterns=[
  new RegExp('^(?:(?:show(?: me)?|check|tell me(?: about)?|give me|what(?:\'s| is))\\s+)?'+subject+"(?:'s)?\\s+"+status+'$'),
  new RegExp('^(?:show(?: me)?|check|tell me|what(?:\'s| is))\\s+(?:the\\s+)?'+status+'\\s+(?:of|on|for)\\s+'+subject+'$'),
  new RegExp('^is\\s+'+subject+'\\s+(?:(?:already|now)\\s+)?(?:done|finished|complete|completed)(?:\\s+yet)?$'),
  new RegExp('^has\\s+'+subject+'\\s+(?:finished|completed)(?:\\s+yet)?$'),
  new RegExp('^how\\s+long\\s+(?:will|does)\\s+'+subject+'\\s+(?:take|need|have\\s+remaining)$'),
  new RegExp('^how\\s+long\\s+(?:until|before)\\s+'+subject+'\\s+(?:is\\s+)?(?:done|finished|complete)$'),
  new RegExp('^how\\s+much\\s+time\\s+(?:is\\s+)?(?:left|remaining)\\s+(?:on|for)\\s+'+subject+'$')
];
export function softwareStatusRequest(request:string){const text=command(request);return statusPatterns.some(pattern=>pattern.test(text));}

export function collaborationPanelRequest(request:string){const text=command(request);return /^(?:(?:open|show|start)(?: me)?\s+(?:(?:my|the|a)\s+)?)?(?:collaborate|collaboration|shared goals?|peer instances|work together)(?:\s+(?:panel|window))?$/.test(text)||/^(?:let's|lets|i want to|can we)\s+(?:collaborate|work together)$/.test(text);}

/** Existing software needs an explicit target/revision or download/start action.
 * Opening its current controls must not pretend an edit or app launch happened. */
export function existingSoftwareRequest(request:string):'revise'|'use'|undefined{
  const text=command(request),app='(?:(?:my|the|this|latest|last|generated|built)\\s+)*(?:app(?:lication)?|software|(?:software\\s+)?build)';
  if(new RegExp('^(?:edit|revise|update|change|modify)\\s+'+app+'\\b[\\s\\S]*$').test(text))return 'revise';
  if(new RegExp('^(?:open|run|use|launch)\\s+'+app+'(?:\\s+preview)?$').test(text))return 'use';
}
