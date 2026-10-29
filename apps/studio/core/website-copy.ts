export type WebsiteCopyAssignment={field:'name'|'title'|'subtitle';value:string};

/** Only an entire, unambiguous copy request gets this typed contract. Mixed
 * actions and ambiguous unquoted conjunctions stay in the general harness. */
export function websiteCopyContract(request:string):WebsiteCopyAssignment[]|undefined{
  const prefix=/^\s*(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:change|set|update)\s+(?:(?:my|the)\s+)?(?:(?:website|business)\s+)?/i.exec(request);
  if(!prefix)return;
  let remaining=request.slice(prefix[0].length);const assignments:WebsiteCopyAssignment[]=[];
  for(let index=0;index<3;index++){
    const field=/^(title|subtitle|name)\s+(?:to|as)\s+/i.exec(remaining);if(!field)return;
    remaining=remaining.slice(field[0].length);let value:string;
    const close:Record<string,string>={'"':'"','“':'”',"'":"'",'‘':'’'},quote=close[remaining[0]];
    if(quote){const end=remaining.indexOf(quote,1);if(end<0)return;value=remaining.slice(1,end);if(value.includes('\\'))return;remaining=remaining.slice(end+1);}
    else{
      if(assignments.length||/[\r\n"“”]/.test(remaining)||/\b(?:and|then|preserve|keep|leave)\b|[,;]\s*(?:add|remove|create|build|show|open|export|change|set|update)\b/i.test(remaining))return;
      value=remaining.trim().replace(/[.!]$/,'').trimEnd();remaining='';
    }
    const name=field[1].toLowerCase() as WebsiteCopyAssignment['field'];
    if(!value.trim()||value.length>3000||assignments.some(item=>item.field===name))return;
    assignments.push({field:name,value});
    if(/^\s*[.!]?\s*(?:(?:preserve|keep|leave)\s+(?:(?:all|the)\s+)?(?:other|rest(?:\s+of\s+the)?)\s+(?:content|website(?:\s+content)?|site(?:\s+content)?)(?:\s+(?:unchanged|as is))?[.!]?)?\s*$/i.test(remaining))return assignments;
    const separator=/^\s*(?:,\s*(?:and\s+)?|and\s+|then\s+|;\s*)(?:(?:change|set|update)\s+)?(?:(?:my|the)\s+)?(?:(?:website|business)\s+)?/i.exec(remaining);
    if(!separator)return;remaining=remaining.slice(separator[0].length);
  }
}
