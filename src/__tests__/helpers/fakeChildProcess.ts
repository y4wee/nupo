import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

export interface FakeProc extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  unref: () => void;
}

/** A minimal fake ChildProcess for mocking `spawn()` results in tests. */
export function makeFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.unref = () => {};
  return proc;
}

/** Polls until `predicate()` is true (e.g. "spawn has been called"), to avoid
 * racing an async function that hasn't yet reached its spawn()/exec() call. */
export async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil: timed out');
    await new Promise(r => setImmediate(r));
  }
}

export function asChildProcess(proc: FakeProc): ChildProcess {
  return proc as unknown as ChildProcess;
}

/** Writes a chunk to stdout/stderr and lets pending microtasks flush before returning. */
export async function writeAndFlush(stream: PassThrough, data: string): Promise<void> {
  stream.write(data);
  await new Promise(r => setImmediate(r));
}

export async function closeProc(proc: FakeProc, code: number): Promise<void> {
  proc.emit('close', code);
  await new Promise(r => setImmediate(r));
}

/** Lets any already-queued microtasks (e.g. a pending `await readFile(...)`) run to completion. */
export async function flushMicrotasks(): Promise<void> {
  await new Promise(r => setImmediate(r));
}
