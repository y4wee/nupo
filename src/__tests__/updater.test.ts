import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('node:https');
vi.mock('node:child_process');

import { get } from 'node:https';
import { execFileSync, spawn } from 'node:child_process';
import { checkForUpdate, performUpdateAndRestart } from '../services/updater.js';
import { makeFakeProc, asChildProcess } from './helpers/fakeChildProcess.js';

const mockGet            = vi.mocked(get);
const mockExecFileSync   = vi.mocked(execFileSync);
const mockSpawn          = vi.mocked(spawn);

function mockHttpResponse(body: string): void {
  mockGet.mockImplementationOnce(((_url: unknown, _opts: unknown, cb: (res: EventEmitter) => void) => {
    const res = new EventEmitter();
    const req = new EventEmitter() as EventEmitter & { setTimeout: (ms: number, fn: () => void) => void; destroy: () => void };
    req.setTimeout = () => {};
    req.destroy = () => {};
    cb(res);
    queueMicrotask(() => {
      res.emit('data', body);
      res.emit('end');
    });
    return req;
  }) as never);
}

function mockHttpError(): void {
  mockGet.mockImplementationOnce((() => {
    const req = new EventEmitter() as EventEmitter & { setTimeout: (ms: number, fn: () => void) => void; destroy: () => void };
    req.setTimeout = () => {};
    req.destroy = () => {};
    queueMicrotask(() => req.emit('error', new Error('network down')));
    return req;
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkForUpdate', () => {
  it('returns true when the registry reports a newer version', async () => {
    mockHttpResponse(JSON.stringify({ version: '99.0.0' }));
    expect(await checkForUpdate()).toBe(true);
  });

  it('returns false when the registry reports the same or an older version', async () => {
    mockHttpResponse(JSON.stringify({ version: '0.0.1' }));
    expect(await checkForUpdate()).toBe(false);
  });

  it('returns false on malformed JSON from the registry', async () => {
    mockHttpResponse('not json');
    expect(await checkForUpdate()).toBe(false);
  });

  it('returns false when the request errors out', async () => {
    mockHttpError();
    expect(await checkForUpdate()).toBe(false);
  });
});

describe('performUpdateAndRestart', () => {
  it('runs npm install -g, then respawns the current process', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));

    performUpdateAndRestart();

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npm', expect.arrayContaining(['install', '-g']), expect.objectContaining({ stdio: 'inherit' }),
    );
    expect(mockSpawn).toHaveBeenCalled();

    proc.emit('exit', 0);
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('exits with code 1 without respawning when npm install fails', () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('npm not found'); });
    // process.exit must actually halt execution here, like in the real process,
    // otherwise the code would fall through to the respawn logic below it.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit(1)'); });

    expect(() => performUpdateAndRestart()).toThrow('process.exit(1)');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockSpawn).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
