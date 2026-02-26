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

export async function checkPython(): Promise<CheckResult> {
  const result = await tryCommand('python3', ['--version']);
  if (result.ok) return result;
  return tryCommand('python', ['--version']);
}

export async function checkPip(): Promise<CheckResult> {
  const result = await tryCommand('pip3', ['--version']);
  if (result.ok) return result;
  return tryCommand('pip', ['--version']);
}

export async function checkVenv(): Promise<CheckResult> {
  const result = await tryCommand('python3', ['-m', 'venv', '--help']);
  if (result.ok) return { ok: true };
  const result2 = await tryCommand('python', ['-m', 'venv', '--help']);
  if (result2.ok) return { ok: true };
  const hint = process.platform === 'darwin'
    ? 'réinstallez Python via python.org ou brew install python3'
    : 'sudo apt install python3-venv';
  return { ok: false, error: `python venv non disponible (${hint})` };
}
