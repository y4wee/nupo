import { execFile, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { cp, rm, access } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
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

export interface DumpEntry {
  name: string;
  folder: string;
  fullPath: string;
}

const DUMP_EXTENSIONS = ['.zip', '.dump', '.sql'];

function isDumpFile(name: string): boolean {
  const lc = name.toLowerCase();
  return DUMP_EXTENSIONS.some(ext => lc.endsWith(ext));
}

/** Lists .zip, .dump and .sql files in repoPath/dumps/ */
export async function listDumps(repoPath: string): Promise<DumpEntry[]> {
  const dumpsDir = join(repoPath, 'dumps');
  try {
    const entries = await readdir(dumpsDir);
    return entries
      .filter(isDumpFile)
      .map(name => ({ name, folder: 'dumps', fullPath: join(dumpsDir, name) }));
  } catch {
    return [];
  }
}

async function walkDir(dir: string): Promise<DumpEntry[]> {
  const results: DumpEntry[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await walkDir(fullPath));
      } else if (entry.isFile() && isDumpFile(entry.name)) {
        results.push({ name: entry.name, folder: basename(dir), fullPath });
      }
    }
  } catch { /* unreadable */ }
  return results;
}

/** Recursively lists .zip, .dump and .sql files under dirPath */
export async function listDumpsFromPath(dirPath: string): Promise<DumpEntry[]> {
  return walkDir(dirPath);
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

/** Reads database.expiration_date from ir_config_parameter */
export async function getExpirationDate(dbName: string): Promise<{ ok: boolean; date?: string; error?: string }> {
  try {
    const { stdout } = await execFileAsync('psql', [
      '--no-password', '--dbname', dbName, '--tuples-only',
      '--command', "SELECT value FROM ir_config_parameter WHERE key = 'database.expiration_date'",
    ]);
    const date = stdout.split('\n').map(l => l.trim()).filter(Boolean)[0];
    return { ok: true, date };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderrOutput?: string };
    return { ok: false, error: e.stderrOutput?.trim() || (e as Error).message };
  }
}

/** Extends database.expiration_date by +1 year */
export async function extendExpirationDate(dbName: string): Promise<DatabaseResult & { newDate?: string; currentDate?: string }> {
  const current = await getExpirationDate(dbName);
  if (!current.ok || !current.date) {
    return { ok: false, error: current.error ?? "Impossible de lire la date d'expiration" };
  }
  const d = new Date(current.date);
  if (isNaN(d.getTime())) {
    return { ok: false, error: `Format de date invalide : ${current.date}` };
  }
  d.setFullYear(d.getFullYear() + 1);
  const newDate = d.toISOString().slice(0, 10);
  try {
    await execFileAsync('psql', [
      '--no-password', '--dbname', dbName,
      '--command', `UPDATE ir_config_parameter SET value = '${newDate}' WHERE key = 'database.expiration_date'`,
    ]);
    return { ok: true, newDate, currentDate: current.date };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderrOutput?: string };
    return { ok: false, error: e.stderrOutput?.trim() || (e as Error).message };
  }
}

/** Lists existing PostgreSQL databases */
export async function listDatabases(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('psql', [
      '--no-password',
      '--dbname', 'postgres',
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

const PG_LIB_DIR = '/usr/lib/postgresql';

/**
 * Finds the newest installed `pg_restore` binary (Debian/Ubuntu layout:
 * /usr/lib/postgresql/<version>/bin/pg_restore). pg_restore must be at least
 * as new as the pg_dump that produced the archive to parse its header
 * (otherwise: "unsupported version (x.xx) in file header"), but a newer
 * pg_restore remains wire-compatible with an older target server — so always
 * preferring the newest available binary is safe and avoids that error
 * regardless of which PostgreSQL version produced the dump. Falls back to
 * the bare `pg_restore` command (whatever PATH/pg_wrapper resolves) when
 * that directory layout isn't present, e.g. on macOS.
 */
export async function findLatestPgRestoreBinary(): Promise<string> {
  let entries;
  try {
    entries = await readdir(PG_LIB_DIR, { withFileTypes: true });
  } catch {
    return 'pg_restore';
  }
  const versions = entries
    .filter(e => e.isDirectory())
    .map(e => parseFloat(e.name))
    .filter(n => !isNaN(n))
    .sort((a, b) => b - a);
  for (const v of versions) {
    const candidate = join(PG_LIB_DIR, String(v), 'bin', 'pg_restore');
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch { /* try next version */ }
  }
  return 'pg_restore';
}

/** Parses the major PostgreSQL version that produced a dump, from `pg_restore --list`'s header. */
export async function getDumpPgVersion(dumpPath: string, pgRestoreBinary: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(pgRestoreBinary, ['--list', dumpPath]);
    const match = stdout.match(/Dumped by pg_dump version:\s*(\d+)/);
    return match ? parseInt(match[1]!, 10) : null;
  } catch {
    return null;
  }
}

/** Reads the target PostgreSQL server's major version via `SHOW server_version_num`. */
export async function getServerVersion(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('psql', [
      '--no-password', '--dbname', 'postgres', '--tuples-only',
      '--command', 'SHOW server_version_num',
    ]);
    const num = parseInt(stdout.trim(), 10);
    return isNaN(num) ? null : Math.floor(num / 10000);
  } catch {
    return null;
  }
}

/**
 * Parallel pg_restore (-j > 1) crashes outright if a worker's initial session
 * setup hits an error — which happens whenever the dump was produced by a
 * newer PostgreSQL major version than the local target server (pg_dump embeds
 * `SET <newer-GUC> = 0;` in its preamble — e.g. `transaction_timeout`, added
 * in PG16 — which an older server rejects as "unrecognized configuration
 * parameter"). That same error is harmless in *sequential* restore (pg_restore
 * just logs it and continues), so when a mismatch is detected this silently
 * falls back to a single job instead of letting the parallel restore crash.
 * Fails open (keeps the requested job count) if either version can't be read.
 */
export async function resolveSafeJobCount(
  requestedJobs: number,
  dumpPath: string,
  pgRestoreBinary: string,
  onLine: (line: string) => void,
): Promise<number> {
  if (requestedJobs <= 1) return requestedJobs;
  const [dumpVersion, serverVersion] = await Promise.all([
    getDumpPgVersion(dumpPath, pgRestoreBinary),
    getServerVersion(),
  ]);
  if (dumpVersion !== null && serverVersion !== null && dumpVersion > serverVersion) {
    onLine(
      `Dump produit par PostgreSQL ${dumpVersion}, serveur local en ${serverVersion} : ` +
      'restauration séquentielle forcée (le mode parallèle plante sur ce décalage de version).',
    );
    return 1;
  }
  return requestedJobs;
}

// Matches pg_restore's own diagnostic prefix specifically — not just any line
// containing "error"/"erreur" anywhere, since plenty of real Odoo columns are
// literally named `error` (e.g. account_edi_document.error), and --verbose's
// routine "création de COMMENT ... .error" progress lines would otherwise be
// misclassified as failures.
const PG_RESTORE_ERROR_LINE_RE = /\bpg_restore:\s*(erreur|error)\s*:/i;

// pg_dump always embeds a block of session-setup `SET` statements (session
// timeouts, encoding, etc.) at the top of every dump. When a dump comes from a
// newer PostgreSQL major version than the local target server, that preamble
// can reference a GUC the server doesn't know yet (e.g. `transaction_timeout`,
// added in PG16) — harmless (it's a session default, not data), but pg_restore
// still reports a non-zero exit status at the end whenever *any* error was
// logged, even one it otherwise ignored and continued past. If every captured
// error line is this exact class of issue, the restore still fully succeeded.
const BENIGN_GUC_ERROR_RE = /unrecognized configuration parameter/i;

/** Restores a PostgreSQL custom-format dump (.dump) via pg_restore, streaming output */
export function spawnPgRestore(
  dbName: string,
  dumpPath: string,
  onLine: (line: string) => void,
  jobs = 1,
): Promise<DatabaseResult> {
  return new Promise(resolve => {
    let stderr = '';

    void findLatestPgRestoreBinary().then(async binary => {
      const effectiveJobs = await resolveSafeJobCount(jobs, dumpPath, binary, onLine);
      const args = [
        '--no-password',
        '--dbname', dbName,
        '--no-owner',
        '--no-privileges',
        '--verbose',
      ];
      if (effectiveJobs > 1) args.push('-j', String(effectiveJobs));
      args.push(dumpPath);

      const proc = spawn(binary, args);

      proc.stdout.on('data', (chunk: Buffer) => {
        for (const l of chunk.toString().split('\n')) {
          const t = l.trim();
          if (t) onLine(t);
        }
      });

      // --verbose makes pg_restore report every processed object on stderr, not
      // just errors, so only lines that actually look like an error are kept for
      // the final failure summary — otherwise it would be swamped with thousands
      // of routine progress lines on a large dump.
      proc.stderr.on('data', (chunk: Buffer) => {
        for (const l of chunk.toString().split('\n')) {
          const t = l.trim();
          if (!t) continue;
          onLine(t);
          if (PG_RESTORE_ERROR_LINE_RE.test(t)) stderr += t + '\n';
        }
      });

      proc.on('close', code => {
        if (code === 0) {
          resolve({ ok: true });
          return;
        }
        const errorLines = stderr.trim().split('\n').filter(Boolean);
        const onlyBenignErrors = errorLines.length > 0 && errorLines.every(l => BENIGN_GUC_ERROR_RE.test(l));
        if (onlyBenignErrors) {
          resolve({ ok: true });
          return;
        }
        resolve({ ok: false, error: stderr.trim() || `pg_restore exited with code ${code}` });
      });

      proc.on('error', err => resolve({ ok: false, error: err.message }));
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
    const fsDir = join(v.path, 'datas', 'filestore');
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
  onStdinReady?: (write: (s: string) => void) => void,
): Promise<DatabaseResult> {
  const base = `python3 <(curl -s https://upgrade.odoo.com/upgrade) ${type} -d ${dbName} -t ${targetVersion}`;
  const cmd = enterpriseCode ? `${base} --contract ${enterpriseCode}` : base;

  return new Promise(resolve => {
    const proc = spawn('bash', ['-c', cmd]);
    onStdinReady?.((s: string) => proc.stdin?.write(s));
    let stderr = '';
    let errorLine = '';

    const detectError = (t: string) => {
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} ERROR:/i.test(t) || /^ERROR:/i.test(t)) {
        errorLine = t.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} ERROR:\s*/i, '')
                     .replace(/^ERROR:\s*/i, '');
      }
    };

    proc.stdout.on('data', (chunk: Buffer) => {
      for (const l of chunk.toString().split('\n')) {
        const t = l.trim();
        if (!t) continue;
        onLine(t);
        detectError(t);
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      for (const l of chunk.toString().split('\n')) {
        const t = l.trim();
        if (!t) continue;
        stderr += t + '\n';
        onLine(t);
        detectError(t);
      }
    });

    proc.on('close', code => {
      if (errorLine) {
        resolve({ ok: false, error: errorLine });
      } else if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: stderr.trim() || `Migration exited with code ${code}` });
      }
    });

    proc.on('error', err => resolve({ ok: false, error: err.message }));
  });
}

/** Neutralizes an Odoo database (disables mail, crons, payment providers, etc.) */
export function spawnNeutralize(
  dbName: string,
  versionPath: string,
  addonsPaths: string[],
): Promise<DatabaseResult> {
  const python  = join(versionPath, '.venv', 'bin', 'python3');
  const odooBin = join(versionPath, 'community', 'odoo-bin');

  return new Promise(resolve => {
    // odoo-bin's CLI dispatcher (odoo/cli/command.py) only recognizes the
    // shared --addons-path option as a subcommand prefix when it is a single
    // "--addons-path=<value>" token; passed as two separate argv entries, it
    // is swallowed by the default "server" command instead, which then
    // rejects "neutralize" as an unrecognized positional parameter.
    const proc = spawn(python, [odooBin, `--addons-path=${addonsPaths.join(',')}`, 'neutralize', '-d', dbName]);
    let stderr = '';

    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', code => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: stderr.trim() || `neutralize exited with code ${code}` });
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
