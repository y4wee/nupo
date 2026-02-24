import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'child_process';

vi.mock('node:child_process');

import { execFile } from 'node:child_process';
import { checkPython, checkPip } from '../services/checks.js';

const mockExecFile = vi.mocked(execFile);

type ExecFileCallback = (
  err: NodeJS.ErrnoException | null,
  stdout: string,
  stderr: string,
) => void;

function makeSuccess(stdout: string) {
  return (_cmd: string, _args: string[], cb: ExecFileCallback): ChildProcess => {
    cb(null, stdout, '');
    return {} as ChildProcess;
  };
}

function makeError(message: string) {
  return (_cmd: string, _args: string[], cb: ExecFileCallback): ChildProcess => {
    const err = Object.assign(new Error(message), { code: 'ENOENT' }) as NodeJS.ErrnoException;
    cb(err, '', '');
    return {} as ChildProcess;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkPython', () => {
  it('returns ok=true with version when python3 succeeds', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('Python 3.10.12') as never);
    const result = await checkPython();
    expect(result.ok).toBe(true);
    expect(result.version).toBe('3.10.12');
  });

  it('falls back to python when python3 is not found', async () => {
    mockExecFile
      .mockImplementationOnce(makeError('spawn python3 ENOENT') as never)
      .mockImplementationOnce(makeSuccess('Python 3.8.0') as never);
    const result = await checkPython();
    expect(result.ok).toBe(true);
    expect(result.version).toBe('3.8.0');
  });

  it('returns ok=false when neither python3 nor python is found', async () => {
    mockExecFile
      .mockImplementationOnce(makeError('spawn python3 ENOENT') as never)
      .mockImplementationOnce(makeError('spawn python ENOENT') as never);
    const result = await checkPython();
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('checkPip', () => {
  it('returns ok=true with version when pip3 succeeds', async () => {
    mockExecFile.mockImplementationOnce(
      makeSuccess('pip 23.0.1 from /usr/lib/python3/dist-packages/pip (python 3.11)') as never,
    );
    const result = await checkPip();
    expect(result.ok).toBe(true);
    expect(result.version).toBe('23.0.1');
  });

  it('falls back to pip when pip3 is not found', async () => {
    mockExecFile
      .mockImplementationOnce(makeError('spawn pip3 ENOENT') as never)
      .mockImplementationOnce(
        makeSuccess('pip 22.0.4 from /usr/local/lib (python 3.9)') as never,
      );
    const result = await checkPip();
    expect(result.ok).toBe(true);
    expect(result.version).toBe('22.0.4');
  });

  it('returns ok=false when neither pip3 nor pip is found', async () => {
    mockExecFile
      .mockImplementationOnce(makeError('spawn pip3 ENOENT') as never)
      .mockImplementationOnce(makeError('spawn pip ENOENT') as never);
    const result = await checkPip();
    expect(result.ok).toBe(false);
  });
});
