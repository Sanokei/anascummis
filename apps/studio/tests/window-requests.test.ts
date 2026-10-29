import {test,expect} from 'bun:test';
import {softwareStatusRequest,collaborationPanelRequest,existingSoftwareRequest} from '../core/window-requests';
import {softwareRequested} from '../core/software-tools';

test('whole build goals containing progress, remaining tasks and collaboration remain build requests',()=>{
  for(const text of [
    'Build a task-list application with heading My Tasks, a text input labelled New task, an Add button, and a Remove button for each task. Add task text to the list, remove individual tasks, and persist remaining tasks after a page reload. Include browser checks and give me the source ZIP.',
    'Build an application with a status filter and remaining tasks.',
    'Create an app showing completed tasks and remaining tasks.',
    'Build an application where teammates work together.',
    'Please create an application with a collaboration panel and shared goals.',
    'Make an application with heading "Build progress".',
    'Develop a program with a button labelled Done and a task status field.'
  ]){expect(softwareRequested(text)).toBe(true);expect(softwareStatusRequest(text)).toBe(false);expect(collaborationPanelRequest(text)).toBe(false);expect(existingSoftwareRequest(text)).toBeUndefined();}
});

test('actual whole status questions stay read-only without consuming appended work',()=>{
  for(const text of ['show build progress','Please check the app status.','What is the status of my build?','Is the app finished?','Has my build completed yet?','How long does the app have remaining?','How long will my build take?','How long until the app is done?','How much time is left for my build?','Could you please show my build status?'])expect(softwareStatusRequest(text)).toBe(true);
  for(const text of ['Show build progress and create an app.','The task has a remaining-time status field.','Edit the app heading to Done.','How long should a status message stay visible in my application?','Show tasks','Open work history','Open goals','Open builds'])expect(softwareStatusRequest(text)).toBe(false);
});

test('collaboration shortcuts target the existing panel without matching app descriptions',()=>{
  for(const text of ['Work together','Let’s work together'.replace('’',"'"),'Please open the collaboration panel.','Show shared goals','Can we collaborate?','Peer instances'])expect(collaborationPanelRequest(text)).toBe(true);
  for(const text of ['Our application will allow people to work together.','Build software with collaboration.','Add a shared goal field to the website.','Read the peer instances documentation.'])expect(collaborationPanelRequest(text)).toBe(false);
});

test('existing app requests need visible revision/run controls rather than status or fabricated completion',()=>{
  expect(existingSoftwareRequest('Edit the app heading to Done.')).toBe('revise');
  expect(existingSoftwareRequest('Could you change my application title to My Week?')).toBe('revise');
  for(const text of ['Open my app','Run the built application','Launch this software','Use my latest app'])expect(existingSoftwareRequest(text)).toBe('use');
  for(const text of ['Open builds','Show build progress','Edit the website heading','Show tasks','Open a PDF','Build an application with a Run button'])expect(existingSoftwareRequest(text)).toBeUndefined();
});
