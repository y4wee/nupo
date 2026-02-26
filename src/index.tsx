#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { CliStartArgs } from './types/index.js';

// ── CLI argument parsing ──────────────────────────────────────────────────────
function parseCliArgs(): CliStartArgs | null {
  const args = process.argv.slice(2);
  if (args[0] !== 'start' || !args[1]) return null;

  const result: CliStartArgs = { serviceName: args[1]!, stopAfterInit: false, shell: false };

  for (let i = 2; i < args.length; i++) {
    switch (args[i]) {
      case '-d': if (args[i + 1]) result.db      = args[++i]; break;
      case '-u': if (args[i + 1]) result.module  = args[++i]; break;
      case '-i': if (args[i + 1]) result.install = args[++i]; break;
      case '--stop-after-init': result.stopAfterInit = true; break;
      case '--shell':           result.shell         = true; break;
    }
  }

  return result;
}

const startupArgs = parseCliArgs();

// ── Alternate screen buffer ───────────────────────────────────────────────────
// Enter alternate screen + hide cursor before rendering anything
process.stdout.write('\x1B[?1049h\x1B[?25l');

let cleanedUp = false;

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  // Restore main screen buffer + show cursor
  process.stdout.write('\x1B[?1049l\x1B[?25h');
}

// Guarantee cleanup on every possible exit path
process.on('exit',              cleanup);
process.on('SIGTERM',           () => { cleanup(); process.exit(0); });
process.on('SIGINT',            () => { cleanup(); process.exit(0); });
process.on('uncaughtException', err => {
  cleanup();
  process.stderr.write(`\nnupo: erreur non gérée : ${err.message}\n${err.stack ?? ''}\n`);
  process.exit(1);
});
process.on('unhandledRejection', reason => {
  cleanup();
  process.stderr.write(`\nnupo: promesse rejetée : ${String(reason)}\n`);
  process.exit(1);
});

// ── Render ────────────────────────────────────────────────────────────────────
let instance: ReturnType<typeof render>;

function handleExit() {
  instance.clear();
  instance.unmount();
  cleanup();
}

instance = render(<App onExit={handleExit} startupArgs={startupArgs ?? undefined} />, {
  exitOnCtrlC: false,
});

process.stdout.on('resize', () => {
  process.stdout.write('\x1B[2J\x1B[H');
});
