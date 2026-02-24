import { execFile, spawn } from 'node:child_process';

export const ODOO_COMMUNITY_URL = 'https://github.com/odoo/odoo.git';
// Enterprise is a private repo: use SSH so the user's key is used automatically.
export const ODOO_ENTERPRISE_URL = 'git@github.com:odoo/enterprise.git';

export interface GitResult {
  ok: boolean;
  error?: string;
}

export interface GitProgress {
  phase: 'receiving' | 'resolving';
  percent: number;
  speed?: string; // e.g. "3.14 MiB/s"
}

// GIT_TERMINAL_PROMPT=0 prevents git from hanging waiting for credential input
// when there is no TTY (execFile / spawn have no TTY by default).
// LC_ALL=C forces English output so progress line parsing works regardless of system locale.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };

function execFileAsync(
  cmd: string,
  args: string[],
  maxBuffer = 1024 * 1024,
  options: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer, env: GIT_ENV, cwd: options.cwd }, (err, stdout, stderr) => {
      if (err) { reject(err); return; }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/**
 * Parse a single git progress line into a structured object.
 * Git writes lines like:
 *   "Receiving objects:  45% (5555/12345), 10.23 MiB | 3.14 MiB/s"
 *   "Resolving deltas:   67% (1234/1844)"
 */
function parseGitProgress(line: string): GitProgress | null {
  const m = line.match(
    /^(Receiving objects|Resolving deltas):\s+(\d+)%[^|]*(?:\|\s*([\d.]+ \S+\/s))?/,
  );
  if (!m) return null;
  return {
    phase: m[1] === 'Receiving objects' ? 'receiving' : 'resolving',
    percent: parseInt(m[2]!, 10),
    speed: m[3]?.trim(),
  };
}

/**
 * Check whether a branch exists on a remote git repository.
 * Uses `git ls-remote` — no clone required.
 */
export async function checkBranch(repoUrl: string, branch: string): Promise<GitResult> {
  try {
    const { stdout } = await execFileAsync('git', [
      'ls-remote', '--heads', repoUrl, `refs/heads/${branch}`,
    ]);
    if (stdout.trim()) return { ok: true };
    return { ok: false, error: `Branche "${branch}" introuvable dans le dépôt` };
  } catch (err) {
    return { ok: false, error: (err as NodeJS.ErrnoException).message ?? String(err) };
  }
}

/**
 * Get the HEAD commit hash of a local git repository.
 */
export async function getLocalCommit(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], 1024 * 1024, { cwd: repoPath });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Get the HEAD commit hash for a branch on a remote (via ls-remote).
 */
export async function getRemoteCommit(repoUrl: string, branch: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', repoUrl, `refs/heads/${branch}`]);
    const hash = stdout.trim().split(/[\t\s]/)[0] ?? '';
    return hash || null;
  } catch {
    return null;
  }
}

/**
 * Update a local shallow clone:
 *   git fetch --depth 1 --progress origin <branch>  (stderr streamed for progress)
 *   git reset --hard origin/<branch>
 */
export function updateRepo(
  repoPath: string,
  branch: string,
  onProgress?: (progress: GitProgress) => void,
): Promise<GitResult> {
  return new Promise(resolve => {
    const fetchProc = spawn(
      'git',
      ['fetch', '--depth', '1', '--progress', 'origin', branch],
      { env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'], cwd: repoPath },
    );

    let stderrFull = '';

    fetchProc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrFull += text;
      for (const part of text.split(/[\r\n]/)) {
        const line = part.trim();
        if (!line) continue;
        const progress = parseGitProgress(line);
        if (progress) onProgress?.(progress);
      }
    });

    fetchProc.stdout?.resume();

    let settled = false;
    const done = (result: GitResult) => {
      if (!settled) { settled = true; resolve(result); }
    };

    fetchProc.on('error', err => done({ ok: false, error: err.message }));

    fetchProc.on('close', code => {
      if (code !== 0) {
        const errorMsg =
          stderrFull.split('\n').map(l => l.trim()).filter(l => /^(fatal|error):/i.test(l)).join(' · ') ||
          stderrFull.trim().split('\n').pop()?.trim() ||
          'Fetch échoué';
        done({ ok: false, error: errorMsg });
        return;
      }
      // fetch OK → reset --hard
      execFileAsync('git', ['reset', '--hard', `origin/${branch}`], 1024 * 1024, { cwd: repoPath })
        .then(() => done({ ok: true }))
        .catch(err => done({ ok: false, error: (err as NodeJS.ErrnoException).message }));
    });
  });
}

/**
 * Clone a repository with --depth 1 (no full history).
 * Streams stderr in real time to call onProgress with parsed progress info.
 */
export function cloneRepo(
  url: string,
  dest: string,
  branch: string,
  onProgress?: (progress: GitProgress) => void,
): Promise<GitResult> {
  return new Promise(resolve => {
    const proc = spawn(
      'git',
      ['clone', '--depth', '1', '--branch', branch, '--progress', url, dest],
      { env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    // Collect stderr for error extraction; parse progress in real time
    let stderrFull = '';

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrFull += text;

      // Git uses \r to overwrite progress lines on the same terminal line.
      // Split on both \r and \n to get individual lines.
      for (const part of text.split(/[\r\n]/)) {
        const line = part.trim();
        if (!line) continue;
        const progress = parseGitProgress(line);
        if (progress) onProgress?.(progress);
      }
    });

    // stdout is usually empty for git clone; drain it to avoid backpressure
    proc.stdout?.resume();

    let settled = false;
    const done = (result: GitResult) => {
      if (!settled) { settled = true; resolve(result); }
    };

    proc.on('error', err => done({ ok: false, error: err.message }));

    proc.on('close', code => {
      if (code === 0) {
        done({ ok: true });
      } else {
        // Extract the most meaningful line from stderr (fatal: / error: lines)
        const errorMsg =
          stderrFull
            .split('\n')
            .map(l => l.trim())
            .filter(l => /^(fatal|error):/i.test(l))
            .join(' · ') ||
          stderrFull.trim().split('\n').pop()?.trim() ||
          'Clone échoué';
        done({ ok: false, error: errorMsg });
      }
    });
  });
}
