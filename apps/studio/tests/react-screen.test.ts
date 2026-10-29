import {test,expect} from 'bun:test';
import {compileNumericScreen,counterSkillSpec,counterSkillGoal,counterSkillBrowserContract,counterSkillEvidenceMatches,groundNumericScreen} from '../core/react-screen';

const goal='Build a small counter application with heading Bakery Orders, a count starting at zero, an Increment button that adds one, and a Reset button that returns to zero. Include browser checks and give me the source ZIP.';
const candidate={title:'Bakery Orders Counter',outputLabel:'Count',buttonLabel:'Increment',initial:0,delta:1};

test('the complete bounded heading/Increment/Reset/browser/ZIP request has a grounded host contract',()=>{
 expect(counterSkillSpec(goal)).toEqual({heading:'Bakery Orders',resetButton:'Reset'});
 expect(counterSkillBrowserContract(goal)).toEqual({kind:'counter',label:'Count',button:'Increment',heading:'Bakery Orders',resetButton:'Reset'});
 expect(groundNumericScreen(goal,candidate)).toEqual({...candidate,title:'Bakery Orders',resetButtonLabel:'Reset'});
});

test('Reset compiles as an initial-value state update while older numeric screens remain compatible',()=>{
 const source=compileNumericScreen(groundNumericScreen(goal,candidate));
 expect(source).toContain('setValue(spec.initial)');
 expect(source).toContain('previous=>previous+spec.delta');
 expect(source).toContain('resetButtonLabel');
 expect(new Bun.Transpiler({loader:'tsx'}).transformSync(source)).toContain('useState');
 const old=compileNumericScreen(candidate);
 expect(old).not.toContain('setValue(spec.initial)');
 expect(counterSkillGoal('Create a Bun Nextjs React counter app. The count starts at zero and an Increment button adds one. Test it.')).toBe(true);
});

test('literal headings remain data and an unsupported suffix never becomes covered counter work',()=>{
 expect(counterSkillSpec(goal.replace('Bakery Orders','"Rock and Roll"'))?.heading).toBe('Rock and Roll');
 const hostile=goal.replace('Bakery Orders','"</h1><script>throw Error(1)</script>"');
 const source=compileNumericScreen(groundNumericScreen(hostile,candidate));
 expect(source).not.toContain('dangerouslySetInnerHTML');
 expect(new Bun.Transpiler({loader:'tsx'}).transformSync(source)).toContain('useState');
 for(const extra of [' Export a PDF.',' Save the count permanently.',' Add a Decrement button.',' Add login.',' Show current news.',' 显示天气'])expect(counterSkillGoal(goal+extra)).toBe(false);
 expect(counterSkillGoal(goal.replace('adds one','adds ten'))).toBe(false);
 expect(counterSkillGoal(goal.replace('adds one','adds zero'))).toBe(false);
 expect(counterSkillGoal(goal.replace('returns to zero','returns to one'))).toBe(false);
 expect(counterSkillGoal(goal+' The initial value is one.')).toBe(false);
});

test('old Increment-only or wrong-heading proof cannot certify the new full request',()=>{
 expect(counterSkillEvidenceMatches(goal,{kind:'counter',label:'Count',button:'Increment'})).toBe(false);
 expect(counterSkillEvidenceMatches(goal,{kind:'counter',label:'Count',button:'Increment',resetButton:'Reset',heading:'Bakery Orders Counter'})).toBe(false);
 expect(counterSkillEvidenceMatches(goal,counterSkillBrowserContract(goal))).toBe(true);
 expect(counterSkillEvidenceMatches(goal,{...counterSkillBrowserContract(goal),delta:2})).toBe(false);
});

test('optional Reset labels must be nonempty and distinct from Increment',()=>{
 expect(()=>compileNumericScreen({...candidate,resetButtonLabel:' '})).toThrow('distinct');
 expect(()=>compileNumericScreen({...candidate,resetButtonLabel:'Increment'})).toThrow('distinct');
 expect(()=>compileNumericScreen({...candidate,resetButtonLabel:false})).toThrow();
});
