#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';

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

instance = render(<App onExit={handleExit} />, {
  exitOnCtrlC: false,
});

process.stdout.on('resize', () => {
  process.stdout.write('\x1B[2J\x1B[H');
});
