import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('clipboardy', () => ({
  default: { writeSync: vi.fn() },
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, openSync: vi.fn(), writeSync: vi.fn(), closeSync: vi.fn() };
});
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawnSync: vi.fn() };
});

import clipboard from 'clipboardy';
import { openSync, writeSync, closeSync } from 'fs';
import { spawnSync } from 'child_process';
import { createServer, Server } from 'net';
import { extractCopyableCommand, copyToClipboard, openInEditor, runInTerminal, checkPortAvailability } from '../services/system.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractCopyableCommand', () => {
  it('prefers a "sudo apt" line over a generic "sudo" line', () => {
    const msg = 'Some error\nsudo systemctl restart foo\nsudo apt install python3-venv\nmore text';
    expect(extractCopyableCommand(msg)).toBe('sudo apt install python3-venv');
  });

  it('falls back to any "sudo" line when no "sudo apt" line exists', () => {
    const msg = 'Error\nsudo dnf install python3-venv\n';
    expect(extractCopyableCommand(msg)).toBe('sudo dnf install python3-venv');
  });

  it('returns null when there is no sudo line', () => {
    expect(extractCopyableCommand('just a plain error')).toBeNull();
  });

  it('ignores blank lines', () => {
    const msg = '\n\n  sudo apt install foo  \n\n';
    expect(extractCopyableCommand(msg)).toBe('sudo apt install foo');
  });
});

describe('copyToClipboard', () => {
  it('returns "ok" when the native clipboard write succeeds', () => {
    expect(copyToClipboard('hello')).toBe('ok');
    expect(clipboard.writeSync).toHaveBeenCalledWith('hello');
  });

  it('falls back to the OSC 52 /dev/tty write when the native clipboard throws', () => {
    vi.mocked(clipboard.writeSync).mockImplementation(() => { throw new Error('no clipboard tool'); });
    const result = copyToClipboard('hello');
    expect(result).toBe('ok');
    expect(openSync).toHaveBeenCalledWith('/dev/tty', 'w');
    expect(writeSync).toHaveBeenCalled();
    expect(closeSync).toHaveBeenCalled();
  });

  it('returns "failed" when both the native clipboard and the OSC 52 fallback throw', () => {
    vi.mocked(clipboard.writeSync).mockImplementation(() => { throw new Error('no clipboard tool'); });
    vi.mocked(openSync).mockImplementation(() => { throw new Error('no tty'); });
    expect(copyToClipboard('hello')).toBe('failed');
  });
});

describe('openInEditor / runInTerminal', () => {
  const originalEnv = { ...process.env };
  afterEach(() => { process.env = { ...originalEnv }; });

  it('uses $EDITOR when set', () => {
    process.env['EDITOR'] = 'vim';
    delete process.env['VISUAL'];
    openInEditor('/tmp/foo.conf');
    expect(spawnSync).toHaveBeenCalledWith('vim', ['/tmp/foo.conf'], { stdio: 'inherit' });
  });

  it('falls back to $VISUAL then "nano" when $EDITOR is unset', () => {
    delete process.env['EDITOR'];
    process.env['VISUAL'] = 'code --wait';
    openInEditor('/tmp/foo.conf');
    expect(spawnSync).toHaveBeenCalledWith('code --wait', ['/tmp/foo.conf'], { stdio: 'inherit' });

    delete process.env['VISUAL'];
    openInEditor('/tmp/foo.conf');
    expect(spawnSync).toHaveBeenCalledWith('nano', ['/tmp/foo.conf'], { stdio: 'inherit' });
  });

  it('runInTerminal spawns the given command with inherited stdio', () => {
    runInTerminal('ls', ['-la']);
    expect(spawnSync).toHaveBeenCalledWith('ls', ['-la'], { stdio: 'inherit' });
  });
});

describe('checkPortAvailability', () => {
  let blocker: Server | null = null;
  afterEach(async () => {
    if (blocker) await new Promise<void>(r => blocker!.close(() => r()));
    blocker = null;
  });

  function listenOnFreePort(): Promise<number> {
    return new Promise(resolve => {
      blocker = createServer();
      blocker.listen(0, '0.0.0.0', () => {
        const addr = blocker!.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
  }

  it('returns "in_use" when another server is already listening on the port', async () => {
    const port = await listenOnFreePort();
    expect(await checkPortAvailability(port)).toBe('in_use');
  });

  it('returns "available" once the port has been released, and releases it again itself', async () => {
    const port = await listenOnFreePort();
    await new Promise<void>(r => blocker!.close(() => r()));
    blocker = null;
    expect(await checkPortAvailability(port)).toBe('available');
    expect(await checkPortAvailability(port)).toBe('available');
  });
});
