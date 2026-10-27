import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'child_process';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('node:child_process');

const homeState = vi.hoisted(() => ({ dir: '' }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => homeState.dir };
});

import { execFile } from 'node:child_process';
import {
  checkPython,
  checkPip,
  checkVenv,
  checkSSH,
  getActiveSSHKeyPath,
  verifySSHKey,
  generateSSHKey,
  readSSHPublicKey,
  addSSHConfig,
} from '../services/checks.js';

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

describe('checkVenv', () => {
  it('ok=true when python3 -m venv --help succeeds', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('usage: venv ...') as never);
    expect(await checkVenv()).toEqual({ ok: true });
  });

  it('falls back to python when python3 fails, and reports ok=false with a hint if both fail', async () => {
    mockExecFile
      .mockImplementationOnce(makeError('ENOENT') as never)
      .mockImplementationOnce(makeSuccess('usage: venv ...') as never);
    expect(await checkVenv()).toEqual({ ok: true });

    mockExecFile
      .mockImplementationOnce(makeError('ENOENT') as never)
      .mockImplementationOnce(makeError('ENOENT') as never);
    const result = await checkVenv();
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('checkSSH / verifySSHKey', () => {
  it('ok=true when stderr reports successful authentication', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('Hi user! You\'ve successfully authenticated') as never);
    expect(await checkSSH()).toEqual({ ok: true });
  });

  it('ok=false with the raw output otherwise', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('Permission denied (publickey).') as never);
    const result = await checkSSH();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Permission denied');
  });

  it('verifySSHKey passes -i <keyPath> to ssh', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('successfully authenticated') as never);
    expect(await verifySSHKey('/home/u/.ssh/id_ed25519_nupo')).toEqual({ ok: true });
    const call = mockExecFile.mock.calls[0]!;
    expect(call[1]).toEqual(expect.arrayContaining(['-i', '/home/u/.ssh/id_ed25519_nupo']));
  });
});

// getActiveSSHKeyPath reads stderr specifically (ssh -v logs go to stderr), unlike
// checkSSH/verifySSHKey which also fall back to stdout.
function makeSuccessStderr(stderr: string) {
  return (..._args: unknown[]): ChildProcess => {
    const cb = _args[_args.length - 1] as ExecFileCallback;
    cb(null, '', stderr);
    return {} as ChildProcess;
  };
}

describe('getActiveSSHKeyPath', () => {
  it('extracts the accepted key path from verbose stderr', async () => {
    mockExecFile.mockImplementationOnce(
      makeSuccessStderr('debug1: Server accepts key: /home/u/.ssh/id_ed25519_nupo RSA SHA256:xxx') as never,
    );
    expect(await getActiveSSHKeyPath()).toBe('/home/u/.ssh/id_ed25519_nupo');
  });

  it('returns null when no key is mentioned', async () => {
    mockExecFile.mockImplementationOnce(makeSuccessStderr('debug1: nothing relevant here') as never);
    expect(await getActiveSSHKeyPath()).toBeNull();
  });
});

describe('generateSSHKey / readSSHPublicKey / addSSHConfig (real fs, fake $HOME)', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'nupo-ssh-test-'));
    homeState.dir = home;
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('generateSSHKey: reuses an existing key pair instead of regenerating one', async () => {
    const sshDir = join(home, '.ssh');
    await mkdir(sshDir, { recursive: true });
    const keyPath = join(sshDir, 'id_ed25519_nupo');
    await writeFile(`${keyPath}.pub`, 'ssh-ed25519 AAAAEXISTING nupo\n', 'utf-8');

    const result = await generateSSHKey();
    expect(result).toEqual({ ok: true, publicKey: 'ssh-ed25519 AAAAEXISTING nupo', keyPath });
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('generateSSHKey: runs ssh-keygen then reads back the public key when none exists', async () => {
    const sshDir = join(home, '.ssh');
    const keyPath = join(sshDir, 'id_ed25519_nupo');
    mockExecFile.mockImplementationOnce(((..._args: unknown[]) => {
      const cb = _args[_args.length - 1] as (err: Error | null) => void;
      // Simulate ssh-keygen actually writing the key files.
      void mkdir(sshDir, { recursive: true }).then(() =>
        writeFile(`${keyPath}.pub`, 'ssh-ed25519 AAAAGENERATED nupo\n', 'utf-8'),
      ).then(() => cb(null));
      return {} as ChildProcess;
    }) as never);

    const result = await generateSSHKey();
    expect(result).toEqual({ ok: true, publicKey: 'ssh-ed25519 AAAAGENERATED nupo', keyPath });
  });

  it('generateSSHKey: ok=false when ssh-keygen fails', async () => {
    mockExecFile.mockImplementationOnce(((..._args: unknown[]) => {
      const cb = _args[_args.length - 1] as (err: Error | null) => void;
      cb(new Error('ssh-keygen: command not found'));
      return {} as ChildProcess;
    }) as never);
    const result = await generateSSHKey();
    expect(result.ok).toBe(false);
  });

  it('readSSHPublicKey: returns trimmed content when the key exists', async () => {
    const keyPath = join(home, '.ssh', 'id_ed25519_nupo');
    await mkdir(join(home, '.ssh'), { recursive: true });
    await writeFile(`${keyPath}.pub`, 'ssh-ed25519 AAAA...  \n', 'utf-8');
    expect(await readSSHPublicKey(keyPath)).toBe('ssh-ed25519 AAAA...');
  });

  it('readSSHPublicKey: returns null when keyPath is null or the file is missing', async () => {
    expect(await readSSHPublicKey(null)).toBeNull();
    expect(await readSSHPublicKey(join(home, '.ssh', 'does-not-exist'))).toBeNull();
  });

  it('addSSHConfig: appends a Host github.com entry when absent', async () => {
    // addSSHConfig itself doesn't create ~/.ssh — in real use it's always called
    // after generateSSHKey(), which does.
    await mkdir(join(home, '.ssh'), { recursive: true });
    const keyPath = join(home, '.ssh', 'id_ed25519_nupo');
    await addSSHConfig(keyPath);
    const content = await readFile(join(home, '.ssh', 'config'), 'utf-8');
    expect(content).toContain('Host github.com');
    expect(content).toContain(keyPath);
  });

  it('addSSHConfig: is a no-op when github.com is already configured', async () => {
    const sshDir = join(home, '.ssh');
    await mkdir(sshDir, { recursive: true });
    const existing = '# pre-existing\nHost github.com\n  IdentityFile /some/other/key\n';
    await writeFile(join(sshDir, 'config'), existing, 'utf-8');
    await addSSHConfig(join(sshDir, 'id_ed25519_nupo'));
    expect(await readFile(join(sshDir, 'config'), 'utf-8')).toBe(existing);
  });
});
