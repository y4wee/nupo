import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'child_process';

vi.mock('node:child_process');
vi.mock('node:fs/promises');

import { execFile, spawn } from 'node:child_process';
import { access, readFile, writeFile, readdir } from 'node:fs/promises';
import {
  getPythonVersion,
  findPythonBinary,
  createVenv,
  installRequirements,
  pipInstallPackages,
  pipUninstallPackages,
  getInstalledPackages,
  normalizePkg,
} from '../services/python.js';
import { makeFakeProc, asChildProcess, writeAndFlush, closeProc, flushMicrotasks } from './helpers/fakeChildProcess.js';

const mockExecFile = vi.mocked(execFile);
const mockSpawn    = vi.mocked(spawn);
const mockAccess   = vi.mocked(access);
const mockReadFile = vi.mocked(readFile);
const mockReaddir  = vi.mocked(readdir);

type ExecFileCallback = (err: (NodeJS.ErrnoException & { stderrOutput?: string }) | null, stdout: string, stderr: string) => void;

function makeSuccess(stdout: string, stderr = '') {
  return (..._args: unknown[]): ChildProcess => {
    const cb = _args[_args.length - 1] as ExecFileCallback;
    cb(null, stdout, stderr);
    return {} as ChildProcess;
  };
}

function makeError(message: string, opts: { code?: string; stderr?: string } = {}) {
  return (..._args: unknown[]): ChildProcess => {
    const cb = _args[_args.length - 1] as ExecFileCallback;
    const err = Object.assign(new Error(message), { code: opts.code }) as NodeJS.ErrnoException;
    cb(err, '', opts.stderr ?? '');
    return {} as ChildProcess;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockRejectedValue(new Error('ENOENT'));
  mockReaddir.mockRejectedValue(new Error('ENOENT'));
});

describe('normalizePkg', () => {
  it('lowercases and normalizes separators to a single dash', () => {
    expect(normalizePkg('Python_LDAP.Extra')).toBe('python-ldap-extra');
  });
});

describe('getPythonVersion', () => {
  it('extracts X.Y.Z from stdout', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('Python 3.11.6\n') as never);
    expect(await getPythonVersion('python3')).toBe('3.11.6');
  });

  it('falls back to stderr when stdout is empty', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('', 'Python 3.8.0\n') as never);
    expect(await getPythonVersion('python')).toBe('3.8.0');
  });

  it('returns null when the binary is not found', async () => {
    mockExecFile.mockImplementationOnce(makeError('ENOENT', { code: 'ENOENT' }) as never);
    expect(await getPythonVersion('python9')).toBeNull();
  });
});

describe('findPythonBinary', () => {
  it('returns the direct python3.X binary when its version matches', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('Python 3.11.2\n') as never);
    expect(await findPythonBinary('3.11')).toBe('python3.11');
  });

  it('falls back to a pyenv install when the direct binary does not match', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('Python 3.9.0\n') as never); // python3.11 → wrong version
    mockReaddir.mockResolvedValueOnce(['3.11.4', '3.10.0'] as never);
    mockAccess.mockResolvedValueOnce(undefined as never); // pyenv binary accessible
    const result = await findPythonBinary('3.11');
    expect(result).toContain('3.11.4');
    expect(result).toContain('pyenv');
  });

  it('falls back to generic python3/python when nothing version-specific matches', async () => {
    mockExecFile
      .mockImplementationOnce(makeError('ENOENT', { code: 'ENOENT' }) as never) // python3.11
      .mockImplementationOnce(makeSuccess('Python 3.11.9\n') as never);         // python3
    const result = await findPythonBinary('3.11');
    expect(result).toBe('python3');
  });

  it('returns null when nothing matches at all', async () => {
    mockExecFile.mockImplementation(makeError('ENOENT', { code: 'ENOENT' }) as never);
    expect(await findPythonBinary('3.99')).toBeNull();
  });
});

describe('createVenv', () => {
  it('ok=true when the given pythonBin succeeds', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('') as never);
    const result = await createVenv('/tmp/venv', 'python3.11');
    expect(result).toEqual({ ok: true });
    expect(mockExecFile).toHaveBeenCalledWith('python3.11', ['-m', 'venv', '/tmp/venv'], expect.anything(), expect.any(Function));
  });

  it('formats a clear error when the venv package is missing (ensurepip failure)', async () => {
    mockExecFile.mockImplementationOnce(
      makeError('Command failed', { stderr: 'ensurepip is not available' }) as never,
    );
    const result = await createVenv('/tmp/venv', 'python3.11');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('python3.11-venv');
  });

  it('tries python3 then python when no pythonBin is given, stopping at the first success', async () => {
    mockExecFile
      .mockImplementationOnce(makeError('ENOENT', { code: 'ENOENT' }) as never)
      .mockImplementationOnce(makeSuccess('') as never);
    const result = await createVenv('/tmp/venv');
    expect(result).toEqual({ ok: true });
  });

  it('fails with a clear message when neither python3 nor python exist', async () => {
    mockExecFile.mockImplementation(makeError('ENOENT', { code: 'ENOENT' }) as never);
    const result = await createVenv('/tmp/venv');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('introuvable');
  });
});

describe('pipInstallPackages', () => {
  it('resolves ok=true on a clean exit', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = pipInstallPackages('/venv/bin/pip', ['requests']);
    await closeProc(proc, 0);
    expect(await promise).toEqual({ ok: true });
  });

  it('streams stdout/stderr lines to onOutput', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const lines: string[] = [];
    const promise = pipInstallPackages('/venv/bin/pip', ['requests'], l => lines.push(l));
    await writeAndFlush(proc.stdout, 'Collecting requests\n');
    await closeProc(proc, 0);
    await promise;
    expect(lines).toContain('Collecting requests');
  });

  it('formats a compile-error message with the detected package and system libs', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = pipInstallPackages('/venv/bin/pip', ['lxml'], undefined, 'python3.11');
    await writeAndFlush(proc.stderr,
      'Building wheel for lxml (pyproject.toml): started\n' +
      'x86_64-linux-gnu-gcc failed with exit status 1\n',
    );
    await closeProc(proc, 1);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain('lxml');
    expect(result.error).toContain('libxml2-dev');
  });

  it('resolves ok=false when the process itself errors', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = pipInstallPackages('/venv/bin/pip', ['requests']);
    proc.emit('error', new Error('spawn pip ENOENT'));
    expect(await promise).toEqual({ ok: false, error: 'spawn pip ENOENT' });
  });
});

describe('pipUninstallPackages', () => {
  it('resolves ok=true on a clean exit', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = pipUninstallPackages('/venv/bin/pip', ['requests']);
    await closeProc(proc, 0);
    expect(await promise).toEqual({ ok: true });
  });

  it('reports a failure message on non-zero exit', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = pipUninstallPackages('/venv/bin/pip', ['requests']);
    await writeAndFlush(proc.stderr, 'ERROR: Cannot uninstall requests\n');
    await closeProc(proc, 1);
    expect(await promise).toEqual({ ok: false, error: 'ERROR: Cannot uninstall requests' });
  });
});

describe('getInstalledPackages', () => {
  it('returns a normalized set of installed package names', async () => {
    mockExecFile.mockImplementationOnce(
      makeSuccess(JSON.stringify([{ name: 'Python-LDAP', version: '1.0' }, { name: 'requests', version: '2.0' }])) as never,
    );
    const result = await getInstalledPackages('/venv/bin/pip');
    expect(result).toEqual(new Set(['python-ldap', 'requests']));
  });

  it('returns an empty set on error', async () => {
    mockExecFile.mockImplementationOnce(makeError('pip not found', { code: 'ENOENT' }) as never);
    expect(await getInstalledPackages('/venv/bin/pip')).toEqual(new Set());
  });

  it('returns an empty set on malformed JSON', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('not json') as never);
    expect(await getInstalledPackages('/venv/bin/pip')).toEqual(new Set());
  });
});

describe('installRequirements', () => {
  const originalPlatform = process.platform;
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('on Linux, installs the requirements file as-is', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = installRequirements('/venv/bin/pip', '/mod/requirements.txt');
    await closeProc(proc, 0);
    expect(await promise).toEqual({ ok: true });
    expect(mockSpawn).toHaveBeenCalledWith(
      '/venv/bin/pip', ['install', '-r', '/mod/requirements.txt'], expect.anything(),
    );
  });

  it('on macOS without psycopg2 in the file, installs it as-is too', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockReadFile.mockResolvedValueOnce('requests\nlxml\n' as never);
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = installRequirements('/venv/bin/pip', '/mod/requirements.txt');
    await flushMicrotasks(); // let the pending `await readFile(...)` resolve before spawn() is reached
    await closeProc(proc, 0);
    expect(await promise).toEqual({ ok: true });
    expect(mockSpawn).toHaveBeenCalledWith(
      '/venv/bin/pip', ['install', '-r', '/mod/requirements.txt'], expect.anything(),
    );
  });

  it('on macOS with a bare psycopg2 line, strips it and installs psycopg2-binary separately', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockReadFile.mockResolvedValueOnce('requests\npsycopg2==2.9.3\n' as never);

    const firstProc  = makeFakeProc();
    const secondProc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(firstProc));
    mockSpawn.mockReturnValueOnce(asChildProcess(secondProc));

    const promise = installRequirements('/venv/bin/pip', '/mod/requirements.txt');
    await flushMicrotasks(); // let the pending `await readFile(...)` + `await writeFile(...)` resolve
    await closeProc(firstProc, 0);
    await flushMicrotasks(); // let the `await runPip(...)` continuation reach the second spawn() call
    await closeProc(secondProc, 0);
    expect(await promise).toEqual({ ok: true });

    expect(mockSpawn).toHaveBeenNthCalledWith(1, '/venv/bin/pip', ['install', '-r', expect.stringContaining('nupo-requirements-')], expect.anything());
    expect(mockSpawn).toHaveBeenNthCalledWith(2, '/venv/bin/pip', ['install', 'psycopg2-binary'], expect.anything());
  });

  it('on macOS, does NOT strip psycopg2-binary (only the bare "psycopg2" package)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockReadFile.mockResolvedValueOnce('psycopg2-binary==2.9.3\n' as never);
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = installRequirements('/venv/bin/pip', '/mod/requirements.txt');
    await flushMicrotasks();
    await closeProc(proc, 0);
    expect(await promise).toEqual({ ok: true });
    expect(mockSpawn).toHaveBeenCalledWith(
      '/venv/bin/pip', ['install', '-r', '/mod/requirements.txt'], expect.anything(),
    );
  });
});
