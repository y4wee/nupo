import { execFile } from 'node:child_process';

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
