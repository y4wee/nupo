#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';

let instance: ReturnType<typeof render>;

function handleExit() {
  instance.clear();
  instance.unmount();
}

instance = render(<App onExit={handleExit} />, {
  exitOnCtrlC: false,
});

process.stdout.on('resize', () => {
  process.stdout.write('\x1B[2J\x1B[H'); // clear full screen + cursor to top
});
