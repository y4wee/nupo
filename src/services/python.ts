import { execFile, spawn } from 'node:child_process';

export interface PythonResult {
  ok: boolean;
  error?: string;
}

type ExecError = NodeJS.ErrnoException & { stderrOutput: string };

function execFileAsync(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        (err as ExecError).stderrOutput = String(stderr);
        reject(err);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/**
 * Create a Python virtual environment at the given path.
 * Tries python3 first, then python.
 */
export async function createVenv(venvPath: string): Promise<PythonResult> {
  const candidates = ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      await execFileAsync(cmd, ['-m', 'venv', venvPath]);
      return { ok: true };
    } catch (err) {
      const e = err as ExecError;
      if (e.code === 'ENOENT') continue; // command not found, try next
      const detail = e.stderrOutput?.trim() || e.message;
      return { ok: false, error: detail };
    }
  }
  return { ok: false, error: 'python3 / python introuvable sur ce système' };
}

/**
 * Install pip requirements from a requirements.txt file using the venv's pip.
 * Streams stdout/stderr lines to onOutput for live feedback.
 */
export function installRequirements(
  pipPath: string,
  requirementsPath: string,
  onOutput?: (line: string) => void,
): Promise<PythonResult> {
  return new Promise(resolve => {
    const proc = spawn(pipPath, ['install', '-r', requirementsPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderrFull = '';

    const handleChunk = (chunk: Buffer) => {
      for (const part of chunk.toString().split('\n')) {
        const line = part.trim();
        if (line) onOutput?.(line);
      }
    };

    proc.stdout?.on('data', handleChunk);
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrFull += chunk.toString();
      handleChunk(chunk);
    });

    let settled = false;
    const done = (result: PythonResult) => {
      if (!settled) { settled = true; resolve(result); }
    };

    proc.on('error', err => done({ ok: false, error: err.message }));
    proc.on('close', code => {
      if (code === 0) {
        done({ ok: true });
      } else {
        const errMsg =
          stderrFull
            .split('\n')
            .map(l => l.trim())
            .filter(l => /^(error|fatal):/i.test(l))
            .join(' · ') ||
          stderrFull.trim().split('\n').pop()?.trim() ||
          'Installation des dépendances échouée';
        done({ ok: false, error: errMsg });
      }
    });
  });
}
