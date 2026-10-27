import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'child_process';

vi.mock('node:child_process');

import { execFile, spawn } from 'node:child_process';
import { checkBranch, getLocalCommit, getRemoteCommit, updateRepo, cloneRepo, type GitProgress } from '../services/git.js';
import { makeFakeProc, asChildProcess, writeAndFlush, closeProc } from './helpers/fakeChildProcess.js';

const mockExecFile = vi.mocked(execFile);
const mockSpawn = vi.mocked(spawn);

type ExecFileCallback = (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void;

function makeSuccess(stdout: string, stderr = '') {
  return (..._args: unknown[]): ChildProcess => {
    const cb = _args[_args.length - 1] as ExecFileCallback;
    cb(null, stdout, stderr);
    return {} as ChildProcess;
  };
}

function makeError(message: string) {
  return (..._args: unknown[]): ChildProcess => {
    const cb = _args[_args.length - 1] as ExecFileCallback;
    cb(new Error(message), '', '');
    return {} as ChildProcess;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkBranch', () => {
  it('ok=true when ls-remote returns a matching ref', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('abc123\trefs/heads/17.0\n') as never);
    const result = await checkBranch('https://example/repo.git', '17.0');
    expect(result.ok).toBe(true);
  });

  it('ok=false when ls-remote returns nothing', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('') as never);
    const result = await checkBranch('https://example/repo.git', 'missing');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('missing');
  });

  it('ok=false when the git command fails', async () => {
    mockExecFile.mockImplementationOnce(makeError('network unreachable') as never);
    const result = await checkBranch('https://example/repo.git', '17.0');
    expect(result.ok).toBe(false);
  });
});

describe('getLocalCommit', () => {
  it('returns the trimmed commit hash', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('deadbeef\n') as never);
    expect(await getLocalCommit('/some/repo')).toBe('deadbeef');
  });

  it('returns null on error', async () => {
    mockExecFile.mockImplementationOnce(makeError('not a git repo') as never);
    expect(await getLocalCommit('/some/repo')).toBeNull();
  });

  it('returns null for blank output', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('   \n') as never);
    expect(await getLocalCommit('/some/repo')).toBeNull();
  });
});

describe('getRemoteCommit', () => {
  it('extracts the hash from ls-remote tab-separated output', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('cafebabe\trefs/heads/17.0\n') as never);
    expect(await getRemoteCommit('https://example/repo.git', '17.0')).toBe('cafebabe');
  });

  it('returns null on error', async () => {
    mockExecFile.mockImplementationOnce(makeError('timeout') as never);
    expect(await getRemoteCommit('https://example/repo.git', '17.0')).toBeNull();
  });
});

describe('cloneRepo', () => {
  it('resolves ok=true on a clean exit', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = cloneRepo('https://example/repo.git', '/dest', '17.0');
    await closeProc(proc, 0);
    expect(await promise).toEqual({ ok: true });
  });

  it('parses receiving/resolving progress from stderr', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const progresses: GitProgress[] = [];
    const promise = cloneRepo('https://example/repo.git', '/dest', '17.0', p => progresses.push(p));

    await writeAndFlush(proc.stderr, 'Receiving objects:  45% (5555/12345), 10.23 MiB | 3.14 MiB/s\n');
    await writeAndFlush(proc.stderr, 'Resolving deltas:   67% (1234/1844)\n');
    await closeProc(proc, 0);
    await promise;

    expect(progresses).toEqual([
      { phase: 'receiving', percent: 45, speed: '3.14 MiB/s' },
      { phase: 'resolving', percent: 67, speed: undefined },
    ]);
  });

  it('extracts a fatal: line as the error on failure', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = cloneRepo('https://example/repo.git', '/dest', '17.0');
    await writeAndFlush(proc.stderr, "fatal: repository 'https://example/repo.git' not found\n");
    await closeProc(proc, 128);
    expect(await promise).toEqual({ ok: false, error: "fatal: repository 'https://example/repo.git' not found" });
  });

  it('resolves ok=false when the process itself errors (e.g. git not found)', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = cloneRepo('https://example/repo.git', '/dest', '17.0');
    proc.emit('error', new Error('spawn git ENOENT'));
    expect(await promise).toEqual({ ok: false, error: 'spawn git ENOENT' });
  });
});

describe('updateRepo', () => {
  it('runs reset --hard after a successful fetch', async () => {
    const fetchProc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(fetchProc));
    mockExecFile.mockImplementationOnce(makeSuccess('') as never);

    const promise = updateRepo('/repo', '17.0');
    await closeProc(fetchProc, 0);
    expect(await promise).toEqual({ ok: true });
    expect(mockExecFile).toHaveBeenCalledWith(
      'git', ['reset', '--hard', 'origin/17.0'], expect.anything(), expect.any(Function),
    );
  });

  it('fails without attempting reset when fetch exits non-zero', async () => {
    const fetchProc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(fetchProc));

    const promise = updateRepo('/repo', '17.0');
    await writeAndFlush(fetchProc.stderr, 'fatal: could not read from remote repository\n');
    await closeProc(fetchProc, 1);
    expect(await promise).toEqual({ ok: false, error: 'fatal: could not read from remote repository' });
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('fails when the post-fetch reset --hard itself fails', async () => {
    const fetchProc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(fetchProc));
    mockExecFile.mockImplementationOnce(makeError('could not reset') as never);

    const promise = updateRepo('/repo', '17.0');
    await closeProc(fetchProc, 0);
    expect(await promise).toEqual({ ok: false, error: 'could not reset' });
  });
});
