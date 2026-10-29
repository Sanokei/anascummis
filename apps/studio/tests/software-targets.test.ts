import {test, expect} from 'bun:test';
import {defaultSoftwareTargets} from '../core/software-targets';

test('default builds do not require a Windows executable on Linux or macOS', () => {
  expect(defaultSoftwareTargets('linux')).toEqual(['zip']);
  expect(defaultSoftwareTargets('darwin')).toEqual(['zip']);
  expect(defaultSoftwareTargets('win32')).toEqual(['zip', 'exe']);
});
