#!/usr/bin/env node
import {runSuite} from './e2e/runner.mjs';
import {journeys} from './e2e/journeys.mjs';

const args = process.argv.slice(2), options = {viewport: 'all', journey: 'all', allowBlocked: false, requireModel: false};
try {
  for (let at = 0; at < args.length; at++) {
    const flag = args[at];
    if (flag === '--allow-blocked') options.allowBlocked = true;
    else if (flag === '--require-model') options.requireModel = true;
    else if (flag === '--require-goals') options.requireGoals = true;
    else if (['--viewport', '--journey', '--output'].includes(flag)) {const value = args[++at]; if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag); options[flag.slice(2)] = value;}
    else if (flag === '--list') {console.log(journeys.map(journey => `${journey.id}: ${journey.goal}`).join('\n')); process.exit(0);}
    else if (flag === '--help') {console.log('node scripts/test-user-journeys.mjs [--viewport all|desktop|narrow] [--journey all|ID] [--output DIR] [--allow-blocked] [--require-model|--require-goals]\nExit 0: all user goals achieved; 1: a failed assertion/setup; 2: a user goal blocked. --allow-blocked permits diagnostic exit0 but keeps the report incomplete. No model or browser is downloaded.'); process.exit(0);}
    else throw new Error('Unknown option: ' + flag);
  }
  if (options.requireGoals) options.allowBlocked = false;
  const report = await runSuite(journeys, options); process.exitCode = report.exitCode;
} catch (error) {console.error(error.stack || String(error)); process.exitCode = 1;}
