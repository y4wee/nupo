import { execFile } from 'node:child_process';
import { homedir } from 'os';
import { join } from 'path';
import { readFile, access, mkdir, appendFile } from 'fs/promises';

function execFileAsync(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) { reject(err); return; }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export interface CheckResult {
  ok: boolean;
  version?: string;
  error?: string;
}

async function tryCommand(cmd: string, args: string[]): Promise<CheckResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args);
    const output = (stdout || stderr).trim();
    const versionMatch = output.match(/\d+\.\d+\.\d+/);
    return { ok: true, version: versionMatch?.[0] };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    return { ok: false, error: error.message ?? String(err) };
  }
}

const isMac = process.platform === 'darwin';

const HINTS = {
  python: isMac
    ? 'brew install python3  (ou téléchargez depuis https://python.org)'
    : 'sudo apt install python3   # Debian/Ubuntu\nsudo dnf install python3   # Fedora/RHEL',
  pip: isMac
    ? 'brew install python3  (pip3 inclus)\nou : python3 -m ensurepip --upgrade'
    : 'sudo apt install python3-pip   # Debian/Ubuntu\nsudo dnf install python3-pip   # Fedora/RHEL',
  venv: isMac
    ? 'brew install python3  (venv inclus)'
    : 'sudo apt install python3-venv   # Debian/Ubuntu\nsudo dnf install python3-venv   # Fedora/RHEL',
};

export async function checkPython(): Promise<CheckResult> {
  const result = await tryCommand('python3', ['--version']);
  if (result.ok) return result;
  const result2 = await tryCommand('python', ['--version']);
  if (result2.ok) return result2;
  return { ok: false, error: HINTS.python };
}

export async function checkPip(): Promise<CheckResult> {
  const result = await tryCommand('pip3', ['--version']);
  if (result.ok) return result;
  const result2 = await tryCommand('pip', ['--version']);
  if (result2.ok) return result2;
  return { ok: false, error: HINTS.pip };
}

export async function checkVenv(): Promise<CheckResult> {
  const result = await tryCommand('python3', ['-m', 'venv', '--help']);
  if (result.ok) return { ok: true };
  const result2 = await tryCommand('python', ['-m', 'venv', '--help']);
  if (result2.ok) return { ok: true };
  return { ok: false, error: HINTS.venv };
}

// ── SSH ───────────────────────────────────────────────────────────────────────

function sshTest(extraArgs: string[] = []): Promise<CheckResult> {
  return new Promise(resolve => {
    execFile(
      'ssh',
      ['-T', 'git@github.com', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=5', ...extraArgs],
      (_err, stdout, stderr) => {
        const output = String(stderr || stdout).trim();
        if (output.includes('successfully authenticated')) resolve({ ok: true });
        else resolve({ ok: false, error: output });
      },
    );
  });
}

export async function checkSSH(): Promise<CheckResult> {
  return sshTest();
}

export async function verifySSHKey(keyPath: string): Promise<CheckResult> {
  return sshTest(['-i', keyPath]);
}

export async function generateSSHKey(): Promise<{ ok: boolean; publicKey?: string; keyPath?: string; error?: string }> {
  const sshDir = join(homedir(), '.ssh');
  const keyPath = join(sshDir, 'id_ed25519_nupo');
  const pubKeyPath = keyPath + '.pub';

  // Reuse existing key if present
  try {
    await access(pubKeyPath);
    const pubKey = await readFile(pubKeyPath, 'utf-8');
    return { ok: true, publicKey: pubKey.trim(), keyPath };
  } catch { /* not found, generate */ }

  try { await mkdir(sshDir, { recursive: true }); } catch { /* already exists */ }

  return new Promise(resolve => {
    execFile('ssh-keygen', ['-t', 'ed25519', '-C', 'nupo', '-f', keyPath, '-N', ''],
      async err => {
        if (err) { resolve({ ok: false, error: err.message }); return; }
        try {
          const pubKey = await readFile(pubKeyPath, 'utf-8');
          resolve({ ok: true, publicKey: pubKey.trim(), keyPath });
        } catch (e) {
          resolve({ ok: false, error: String(e) });
        }
      },
    );
  });
}

export async function addSSHConfig(keyPath: string): Promise<void> {
  const configPath = join(homedir(), '.ssh', 'config');
  const entry = `\n# Added by nupo\nHost github.com\n  IdentityFile ${keyPath}\n  User git\n`;
  try {
    const content = await readFile(configPath, 'utf-8');
    if (content.includes('github.com')) return;
  } catch { /* file doesn't exist, will be created */ }
  await appendFile(configPath, entry, 'utf-8');
}
