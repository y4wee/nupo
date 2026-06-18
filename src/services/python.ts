import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { majorMinor } from '../constants/pythonCompatibility.js';

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

/** Returns the full version string "X.Y.Z" for a given binary, or null if unavailable. */
export async function getPythonVersion(binary: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(binary, ['--version']);
    const m = (stdout || stderr).match(/(\d+\.\d+\.\d+)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

// Finds a Python binary matching the requested "X.Y" major.minor version.
// Search order: python3.Y → pyenv versions dir → python3/python fallback.
export async function findPythonBinary(targetMajorMinor: string): Promise<string | null> {
  const [, minorStr] = targetMajorMinor.split('.');
  const minor = Number(minorStr);

  // 1. Direct versioned binary
  const directCmd = `python3.${minor}`;
  const directVer = await getPythonVersion(directCmd);
  if (directVer && majorMinor(directVer) === targetMajorMinor) return directCmd;

  // 2. pyenv versions directory
  const pyenvBase = join(homedir(), '.pyenv', 'versions');
  try {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(pyenvBase);
    for (const entry of entries.sort().reverse()) {
      if (!entry.startsWith(targetMajorMinor)) continue;
      const candidate = join(pyenvBase, entry, 'bin', 'python3');
      try {
        await access(candidate);
        return candidate;
      } catch { /* not accessible */ }
    }
  } catch { /* pyenv not installed or empty */ }

  // 3. Generic python3 / python
  for (const cmd of ['python3', 'python']) {
    const ver = await getPythonVersion(cmd);
    if (ver && majorMinor(ver) === targetMajorMinor) return cmd;
  }

  return null;
}

// Detects gcc compilation failures and returns an actionable apt/brew hint.
// pythonBin (e.g. "python3.8") is used to generate the version-specific -dev package.
function formatPipError(stderrFull: string, fallback: string, pythonBin?: string): string {
  const isCompileError =
    stderrFull.includes('-linux-gnu-gcc') ||
    stderrFull.includes('linux-gnu-g++') ||
    stderrFull.includes('subprocess-exited-with-error') ||
    stderrFull.includes('legacy-install-failure') ||
    (stderrFull.includes('gcc') && stderrFull.includes('exit status 1'));

  if (!isCompileError) return fallback;

  // python3.8 → "3.8", python3.8.20 → "3.8", undefined → null
  const pyVer = (pythonBin ?? '').match(/(\d+\.\d+)/)?.[1] ?? null;
  const devPkg = pyVer ? `python${pyVer}-dev` : 'python3-dev';

  // Try to identify the failing package
  const pkgMatch =
    stderrFull.match(/install package[.\s]+│\s+(\S+)/m) ??
    stderrFull.match(/[Bb]uilding wheel for ([A-Za-z0-9_.-]+)/m);
  const pkg = pkgMatch?.[1];

  // Per-package specific system libs (most common Odoo deps)
  const KNOWN: Record<string, string> = {
    lxml:          'libxml2-dev libxslt1-dev',
    psycopg2:      'libpq-dev',
    'python-ldap': 'libldap2-dev libsasl2-dev',
    pillow:        'libjpeg-dev zlib1g-dev',
    Pillow:        'libjpeg-dev zlib1g-dev',
  };
  const extraLibs = pkg ? KNOWN[pkg] : undefined;

  const aptPkgs = extraLibs
    ? `build-essential ${devPkg} ${extraLibs}`
    : `build-essential ${devPkg} libxml2-dev libxslt1-dev libldap2-dev libsasl2-dev libssl-dev zlib1g-dev libjpeg-dev libpq-dev`;

  const header = pkg
    ? `Erreur de compilation pour "${pkg}" — headers système manquants.`
    : `Erreur de compilation — headers système manquants.`;

  return `${header}\n  sudo apt install ${aptPkgs}`;
}

// Detects the missing python3.X-venv package error (Debian/Ubuntu) and returns
// a clear, actionable message. Falls back to the raw detail otherwise.
function formatVenvError(e: ExecError, pythonBin?: string): string {
  const raw = [e.stderrOutput ?? '', e.message].join('\n');
  if (raw.includes('ensurepip')) {
    const pyVer = (pythonBin ?? '').match(/(\d+\.\d+)/)?.[1];
    const pkg    = pyVer ? `python${pyVer}-venv` : 'python3-venv';
    const lines  = [
      `Package "${pkg}" manquant sur ce système.`,
      `  Debian/Ubuntu : sudo apt install ${pkg}`,
    ];
    if (pyVer) lines.push(`  macOS         : brew install python@${pyVer}`);
    return lines.join('\n');
  }
  return e.stderrOutput?.trim() || e.message;
}

/**
 * Create a Python virtual environment at the given path.
 * If pythonBin is provided, uses that binary directly.
 * Otherwise tries python3 then python.
 */
export async function createVenv(venvPath: string, pythonBin?: string): Promise<PythonResult> {
  if (pythonBin) {
    try {
      await execFileAsync(pythonBin, ['-m', 'venv', venvPath]);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: formatVenvError(err as ExecError, pythonBin) };
    }
  }

  const candidates = ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      await execFileAsync(cmd, ['-m', 'venv', venvPath]);
      return { ok: true };
    } catch (err) {
      const e = err as ExecError;
      if (e.code === 'ENOENT') continue;
      return { ok: false, error: formatVenvError(e, cmd) };
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
  pythonBin?: string,
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
        const raw =
          stderrFull.split('\n').map(l => l.trim()).filter(l => /^(error|fatal):/i.test(l)).join(' · ') ||
          stderrFull.trim().split('\n').pop()?.trim() ||
          'Installation des dépendances échouée';
        done({ ok: false, error: formatPipError(stderrFull, raw, pythonBin) });
      }
    });
  });
}

/** pip uninstall -y <packages...> with streaming output. */
export function pipUninstallPackages(
  pipPath: string,
  packages: string[],
  onOutput?: (line: string) => void,
): Promise<PythonResult> {
  return new Promise(resolve => {
    const proc = spawn(pipPath, ['uninstall', '-y', ...packages], {
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
    const done = (r: PythonResult) => { if (!settled) { settled = true; resolve(r); } };
    proc.on('error', err => done({ ok: false, error: err.message }));
    proc.on('close', code => {
      if (code === 0) {
        done({ ok: true });
      } else {
        const errMsg =
          stderrFull.split('\n').map(l => l.trim()).filter(l => /^(error|fatal):/i.test(l)).join(' · ') ||
          stderrFull.trim().split('\n').pop()?.trim() ||
          'Désinstallation échouée';
        done({ ok: false, error: errMsg });
      }
    });
  });
}

/** pip install <packages...> with streaming output. */
export function pipInstallPackages(
  pipPath: string,
  packages: string[],
  onOutput?: (line: string) => void,
  pythonBin?: string,
): Promise<PythonResult> {
  return new Promise(resolve => {
    const proc = spawn(pipPath, ['install', ...packages], {
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
    const done = (r: PythonResult) => { if (!settled) { settled = true; resolve(r); } };
    proc.on('error', err => done({ ok: false, error: err.message }));
    proc.on('close', code => {
      if (code === 0) {
        done({ ok: true });
      } else {
        const raw =
          stderrFull.split('\n').map(l => l.trim()).filter(l => /^(error|fatal):/i.test(l)).join(' · ') ||
          stderrFull.trim().split('\n').pop()?.trim() ||
          'Installation échouée';
        done({ ok: false, error: formatPipError(stderrFull, raw, pythonBin) });
      }
    });
  });
}

interface PipPackage { name: string; version: string; }

/** Returns the set of installed package names (normalized: lowercase, - instead of _). */
export async function getInstalledPackages(pipPath: string): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync(pipPath, ['list', '--format=json']);
    const pkgs = JSON.parse(stdout.trim()) as PipPackage[];
    return new Set(pkgs.map(p => normalizePkg(p.name)));
  } catch {
    return new Set();
  }
}

export function normalizePkg(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}
