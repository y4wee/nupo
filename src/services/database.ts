import { execFile, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { cp, rm } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { OdooVersion } from '../types/index.js';

export interface DatabaseResult {
  ok: boolean;
  error?: string;
}

export interface DumpInfo {
  hasDump: boolean;
  hasFilestore: boolean;
}

function execFileAsync(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException & { stderrOutput?: string };
        e.stderrOutput = String(stderr);
        reject(e);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** Lists .zip files in repoPath/dumps/ */
export async function listDumps(repoPath: string): Promise<string[]> {
  const dumpsDir = join(repoPath, 'dumps');
  try {
    const entries = await readdir(dumpsDir);
    return entries.filter(e => e.toLowerCase().endsWith('.zip'));
  } catch {
    return [];
  }
}

/** Inspects a zip to check if it contains dump.sql and/or filestore/ */
export async function inspectDump(zipPath: string): Promise<DumpInfo> {
  try {
    const { stdout } = await execFileAsync('unzip', ['-l', zipPath]);
    const hasDump = /\bdump\.sql\b/.test(stdout);
    const hasFilestore = /\bfilestore[\\/]/.test(stdout);
    return { hasDump, hasFilestore };
  } catch {
    return { hasDump: false, hasFilestore: false };
  }
}

/** Lists existing PostgreSQL databases */
export async function listDatabases(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('psql', [
      '--no-password',
      '--tuples-only',
      '--command', 'SELECT datname FROM pg_database WHERE datistemplate = false',
    ]);
    return stdout
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Creates a new PostgreSQL database owned by odoo */
export async function createDatabase(name: string): Promise<DatabaseResult> {
  try {
    await execFileAsync('createdb', ['-O', 'odoo', name]);
    return { ok: true };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderrOutput?: string };
    return { ok: false, error: e.stderrOutput?.trim() || e.message };
  }
}

/** Creates a temp directory for restore operations */
export function createTempDir(): string {
  const rand = randomBytes(6).toString('hex');
  return join(tmpdir(), `nupo-restore-${rand}`);
}

/** Extracts a zip file with streaming output */
export function extractZip(
  zipPath: string,
  destDir: string,
  onLine: (line: string) => void,
): Promise<DatabaseResult> {
  return new Promise(resolve => {
    const proc = spawn('unzip', ['-o', zipPath, '-d', destDir]);
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const l of lines) {
        const trimmed = l.trim();
        if (trimmed) onLine(trimmed);
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', code => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: stderr.trim() || `unzip exited with code ${code}` });
      }
    });

    proc.on('error', err => {
      resolve({ ok: false, error: err.message });
    });
  });
}

/** Restores a SQL dump into a database via psql, streaming output */
export function spawnPsqlRestore(
  dbName: string,
  dumpPath: string,
  onLine: (line: string) => void,
): Promise<DatabaseResult> {
  return new Promise(resolve => {
    const proc = spawn('psql', [
      '--no-password',
      '--dbname', dbName,
      '--file', dumpPath,
      '--echo-errors',
    ]);
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const l of lines) {
        const trimmed = l.trim();
        if (trimmed) onLine(trimmed);
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const l of lines) {
        const trimmed = l.trim();
        if (trimmed) {
          stderr += trimmed + '\n';
          onLine(trimmed);
        }
      }
    });

    proc.on('close', code => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: stderr.trim() || `psql exited with code ${code}` });
      }
    });

    proc.on('error', err => {
      resolve({ ok: false, error: err.message });
    });
  });
}

/** Copies filestore directory using Node's fs.cp (Node ≥18) */
export async function copyFilestore(src: string, dest: string): Promise<DatabaseResult> {
  try {
    await cp(src, dest, { recursive: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Removes a temp directory */
export async function removeTempDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch { /* non-critical */ }
}

export interface FilestoreEntry {
  dbName: string;
  versionBranch: string;
  filestorePath: string;
}

/** Lists databases found in filestore/ of each installed Odoo version */
export async function listFilestoreDatabases(versions: OdooVersion[]): Promise<FilestoreEntry[]> {
  const result: FilestoreEntry[] = [];
  for (const v of versions) {
    const fsDir = join(v.path, 'filestore');
    try {
      const entries = await readdir(fsDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          result.push({
            dbName: e.name,
            versionBranch: v.branch,
            filestorePath: join(fsDir, e.name),
          });
        }
      }
    } catch { /* filestore dir missing or unreadable */ }
  }
  return result;
}

/** Drops a PostgreSQL database */
export async function dropDatabase(name: string): Promise<DatabaseResult> {
  try {
    await execFileAsync('dropdb', ['--no-password', name]);
    return { ok: true };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderrOutput?: string };
    return { ok: false, error: e.stderrOutput?.trim() || e.message };
  }
}

/** Removes a filestore entry directory */
export async function removeFilestoreEntry(path: string): Promise<DatabaseResult> {
  try {
    await rm(path, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface OdooUser {
  id: number;
  login: string;
  active: boolean;
}

/** Lists res.users rows (id, login, active) from a database */
export async function listUsers(dbName: string): Promise<{ ok: boolean; users: OdooUser[]; error?: string }> {
  try {
    const { stdout } = await execFileAsync('psql', [
      '--no-password',
      '--tuples-only',
      '--no-align',
      '--field-separator', '\t',
      '--dbname', dbName,
      '--command', 'SELECT id, login, active FROM res_users ORDER BY login',
    ]);
    const users = stdout
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .flatMap(l => {
        const parts = l.split('\t');
        const id = parseInt(parts[0] ?? '', 10);
        const login = parts[1] ?? '';
        const active = parts[2]?.trim() === 't';
        if (isNaN(id) || id <= 0 || !login) return [];
        return [{ id, login, active }];
      });
    return { ok: true, users };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderrOutput?: string };
    return { ok: false, users: [], error: e.stderrOutput?.trim() || e.message };
  }
}

/** Hashes a password using the Odoo venv's passlib */
export async function hashPassword(
  clearPassword: string,
  venvPythonPath: string,
): Promise<{ ok: true; hash: string } | { ok: false; error: string }> {
  const script = 'import sys;from passlib.context import CryptContext;ctx=CryptContext(schemes=["pbkdf2_sha512"]);print(ctx.hash(sys.argv[1]),end="")';
  try {
    const { stdout } = await execFileAsync(venvPythonPath, ['-c', script, clearPassword]);
    const hash = stdout.trim();
    if (!hash) return { ok: false, error: 'Hash vide retourné par passlib' };
    return { ok: true, hash };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderrOutput?: string };
    return { ok: false, error: e.stderrOutput?.trim() || e.message };
  }
}

/** Updates res.users.login for a given user id */
export async function setUserLogin(dbName: string, userId: number, login: string): Promise<DatabaseResult> {
  const escaped = login.replace(/'/g, "''");
  try {
    await execFileAsync('psql', [
      '--no-password',
      '--dbname', dbName,
      '--command', `UPDATE res_users SET login = '${escaped}' WHERE id = ${userId}`,
    ]);
    return { ok: true };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderrOutput?: string };
    return { ok: false, error: e.stderrOutput?.trim() || e.message };
  }
}

/** Updates res.users.password (expects an already-hashed value) */
export async function setUserPassword(dbName: string, userId: number, passwordHash: string): Promise<DatabaseResult> {
  const escaped = passwordHash.replace(/'/g, "''");
  try {
    await execFileAsync('psql', [
      '--no-password',
      '--dbname', dbName,
      '--command', `UPDATE res_users SET password = '${escaped}' WHERE id = ${userId}`,
    ]);
    return { ok: true };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderrOutput?: string };
    return { ok: false, error: e.stderrOutput?.trim() || e.message };
  }
}

/** Spawns an Odoo upgrade migration (test or production) via bash process substitution */
export function spawnMigration(
  dbName: string,
  targetVersion: string,
  type: 'test' | 'production',
  enterpriseCode: string | undefined,
  onLine: (line: string) => void,
): Promise<DatabaseResult> {
  const base = `python <(curl -s https://upgrade.odoo.com/upgrade) ${type} -d ${dbName} -t ${targetVersion}`;
  const cmd = type === 'production' && enterpriseCode ? `${base} -c ${enterpriseCode}` : base;

  return new Promise(resolve => {
    const proc = spawn('bash', ['-c', cmd]);
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      for (const l of chunk.toString().split('\n')) {
        const t = l.trim();
        if (t) onLine(t);
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      for (const l of chunk.toString().split('\n')) {
        const t = l.trim();
        if (t) { stderr += t + '\n'; onLine(t); }
      }
    });

    proc.on('close', code => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: stderr.trim() || `Migration exited with code ${code}` });
    });

    proc.on('error', err => resolve({ ok: false, error: err.message }));
  });
}

/** Updates res.users.active for a given user id */
export async function setUserActive(dbName: string, userId: number, active: boolean): Promise<DatabaseResult> {
  try {
    await execFileAsync('psql', [
      '--no-password',
      '--dbname', dbName,
      '--command', `UPDATE res_users SET active = ${active} WHERE id = ${userId}`,
    ]);
    return { ok: true };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderrOutput?: string };
    return { ok: false, error: e.stderrOutput?.trim() || e.message };
  }
}
