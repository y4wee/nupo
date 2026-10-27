import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('node:child_process');
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readdir: vi.fn(actual.readdir), access: vi.fn() };
});

import { execFile, spawn } from 'node:child_process';
import { readdir, access } from 'node:fs/promises';
import {
  listDumps,
  listDumpsFromPath,
  inspectDump,
  getExpirationDate,
  extendExpirationDate,
  listDatabases,
  createDatabase,
  createTempDir,
  extractZip,
  spawnPsqlRestore,
  spawnPgRestore,
  findLatestPgRestoreBinary,
  getDumpPgVersion,
  getServerVersion,
  resolveSafeJobCount,
  copyFilestore,
  removeTempDir,
  listFilestoreDatabases,
  dropDatabase,
  removeFilestoreEntry,
  listUsers,
  hashPassword,
  setUserLogin,
  setUserPassword,
  setUserActive,
  spawnMigration,
  spawnNeutralize,
} from '../services/database.js';
import { makeFakeProc, asChildProcess, writeAndFlush, closeProc, waitUntil } from './helpers/fakeChildProcess.js';

const mockExecFile = vi.mocked(execFile);
const mockSpawn    = vi.mocked(spawn);
const mockReaddir  = vi.mocked(readdir);
const mockAccess   = vi.mocked(access);

type ExecFileCallback = (
  err: (NodeJS.ErrnoException & { stderrOutput?: string }) | null,
  stdout: string,
  stderr: string,
) => void;

function makeSuccess(stdout: string, stderr = '') {
  return (..._args: unknown[]): ChildProcess => {
    const cb = _args[_args.length - 1] as ExecFileCallback;
    cb(null, stdout, stderr);
    return {} as ChildProcess;
  };
}

function makeError(message: string, stderr = '') {
  return (..._args: unknown[]): ChildProcess => {
    const cb = _args[_args.length - 1] as ExecFileCallback;
    cb(new Error(message), '', stderr);
    return {} as ChildProcess;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Filesystem-backed functions (real temp dirs, no mocking needed) ─────────

describe('listDumps / listDumpsFromPath (real fs)', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'nupo-db-test-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('listDumps: returns only recognized dump extensions from <repo>/dumps', async () => {
    await mkdir(join(root, 'dumps'), { recursive: true });
    await writeFile(join(root, 'dumps', 'a.zip'), '', 'utf-8');
    await writeFile(join(root, 'dumps', 'b.sql'), '', 'utf-8');
    await writeFile(join(root, 'dumps', 'c.dump'), '', 'utf-8');
    await writeFile(join(root, 'dumps', 'notes.txt'), '', 'utf-8');
    const result = await listDumps(root);
    expect(result.map(d => d.name).sort()).toEqual(['a.zip', 'b.sql', 'c.dump']);
    expect(result.every(d => d.folder === 'dumps')).toBe(true);
  });

  it('listDumps: returns [] when dumps/ does not exist', async () => {
    expect(await listDumps(root)).toEqual([]);
  });

  it('listDumpsFromPath: recurses into subdirectories, tagging folder with the immediate parent', async () => {
    await mkdir(join(root, 'client-a'), { recursive: true });
    await writeFile(join(root, 'client-a', 'dump.zip'), '', 'utf-8');
    await mkdir(join(root, 'nested', 'client-b'), { recursive: true });
    await writeFile(join(root, 'nested', 'client-b', 'dump.sql'), '', 'utf-8');
    const result = await listDumpsFromPath(root);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'dump.zip', folder: 'client-a' }),
      expect.objectContaining({ name: 'dump.sql', folder: 'client-b' }),
    ]));
  });

  it('listDumpsFromPath: returns [] for an unreadable path', async () => {
    expect(await listDumpsFromPath(join(root, 'does-not-exist'))).toEqual([]);
  });
});

describe('createTempDir', () => {
  it('returns a unique path under the OS temp dir prefixed with nupo-restore-', () => {
    const a = createTempDir();
    const b = createTempDir();
    expect(a).not.toBe(b);
    expect(a).toContain('nupo-restore-');
  });
});

describe('copyFilestore / removeTempDir / removeFilestoreEntry (real fs)', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'nupo-db-test-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('copyFilestore: recursively copies the source into the destination', async () => {
    const src = join(root, 'src');
    await mkdir(join(src, 'sub'), { recursive: true });
    await writeFile(join(src, 'sub', 'file.bin'), 'data', 'utf-8');
    const dest = join(root, 'dest');
    const result = await copyFilestore(src, dest);
    expect(result).toEqual({ ok: true });
    await expect(mkdir(join(dest, 'sub'))).rejects.toThrow(); // already exists → proves the copy happened
  });

  it('copyFilestore: ok=false when the source does not exist', async () => {
    const result = await copyFilestore(join(root, 'nope'), join(root, 'dest'));
    expect(result.ok).toBe(false);
  });

  it('removeTempDir: removes the directory and never throws, even if absent', async () => {
    const dir = join(root, 'to-remove');
    await mkdir(dir, { recursive: true });
    await removeTempDir(dir);
    await expect(removeTempDir(dir)).resolves.toBeUndefined();
  });

  it('removeFilestoreEntry: removes the path and reports ok=true', async () => {
    const dir = join(root, 'entry');
    await mkdir(dir, { recursive: true });
    expect(await removeFilestoreEntry(dir)).toEqual({ ok: true });
  });
});

describe('listFilestoreDatabases (real fs)', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'nupo-db-test-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('lists each directory under <version.path>/datas/filestore as a database entry', async () => {
    const v17 = join(root, '17.0');
    await mkdir(join(v17, 'datas', 'filestore', 'shop'), { recursive: true });
    await mkdir(join(v17, 'datas', 'filestore', 'blog'), { recursive: true });
    const result = await listFilestoreDatabases([{ branch: '17.0', path: v17 }]);
    expect(result.map(r => r.dbName).sort()).toEqual(['blog', 'shop']);
    expect(result[0]!.versionBranch).toBe('17.0');
  });

  it('skips a version with no filestore directory', async () => {
    const v17 = join(root, '17.0');
    await mkdir(v17, { recursive: true });
    expect(await listFilestoreDatabases([{ branch: '17.0', path: v17 }])).toEqual([]);
  });
});

// ── execFile-backed functions (mocked) ──────────────────────────────────────

describe('inspectDump', () => {
  it('detects dump.sql and filestore/ in the unzip listing', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('  dump.sql\n  filestore/foo/bar\n') as never);
    expect(await inspectDump('/x.zip')).toEqual({ hasDump: true, hasFilestore: true });
  });

  it('returns both false when neither is present', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('  README.md\n') as never);
    expect(await inspectDump('/x.zip')).toEqual({ hasDump: false, hasFilestore: false });
  });

  it('returns both false when unzip fails (e.g. corrupt zip)', async () => {
    mockExecFile.mockImplementationOnce(makeError('bad zip') as never);
    expect(await inspectDump('/x.zip')).toEqual({ hasDump: false, hasFilestore: false });
  });
});

describe('getExpirationDate', () => {
  it('returns the date from the first non-empty line', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('\n 2027-01-15 \n\n') as never);
    expect(await getExpirationDate('mydb')).toEqual({ ok: true, date: '2027-01-15' });
  });

  it('ok=false with stderrOutput on failure', async () => {
    mockExecFile.mockImplementationOnce(makeError('conn failed', 'FATAL: database "mydb" does not exist') as never);
    const result = await getExpirationDate('mydb');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('FATAL: database "mydb" does not exist');
  });
});

describe('extendExpirationDate', () => {
  it('adds one year and persists it', async () => {
    mockExecFile
      .mockImplementationOnce(makeSuccess('2027-01-15\n') as never) // getExpirationDate
      .mockImplementationOnce(makeSuccess('') as never);            // UPDATE
    const result = await extendExpirationDate('mydb');
    expect(result).toEqual({ ok: true, newDate: '2028-01-15', currentDate: '2027-01-15' });
  });

  it('fails when the current date cannot be read', async () => {
    mockExecFile.mockImplementationOnce(makeError('conn failed', 'boom') as never);
    const result = await extendExpirationDate('mydb');
    expect(result.ok).toBe(false);
  });

  it('fails on an unparsable date', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('not-a-date\n') as never);
    const result = await extendExpirationDate('mydb');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalide');
  });
});

describe('listDatabases', () => {
  it('returns trimmed, non-empty database names', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('\n shop \n blog\n\n') as never);
    expect(await listDatabases()).toEqual(['shop', 'blog']);
  });

  it('returns [] on error', async () => {
    mockExecFile.mockImplementationOnce(makeError('conn refused') as never);
    expect(await listDatabases()).toEqual([]);
  });
});

describe('createDatabase / dropDatabase', () => {
  it('createDatabase: ok=true on success', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('') as never);
    expect(await createDatabase('shop')).toEqual({ ok: true });
    expect(mockExecFile).toHaveBeenCalledWith('createdb', ['-O', 'odoo', 'shop'], expect.anything(), expect.any(Function));
  });

  it('createDatabase: ok=false with stderr on failure', async () => {
    mockExecFile.mockImplementationOnce(makeError('exists', 'database "shop" already exists') as never);
    const result = await createDatabase('shop');
    expect(result).toEqual({ ok: false, error: 'database "shop" already exists' });
  });

  it('dropDatabase: ok=true on success', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('') as never);
    expect(await dropDatabase('shop')).toEqual({ ok: true });
  });

  it('dropDatabase: ok=false on failure', async () => {
    mockExecFile.mockImplementationOnce(makeError('in use', 'database "shop" is being accessed') as never);
    expect((await dropDatabase('shop')).ok).toBe(false);
  });
});

describe('listUsers', () => {
  it('parses tab-separated rows and skips malformed ones', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess(
      '1\tadmin\tt\n2\tportal_user\tf\n\tnologin\tt\nnotanumber\tx\tt\n',
    ) as never);
    const result = await listUsers('mydb');
    expect(result.ok).toBe(true);
    expect(result.users).toEqual([
      { id: 1, login: 'admin', active: true },
      { id: 2, login: 'portal_user', active: false },
    ]);
  });

  it('ok=false on query failure', async () => {
    mockExecFile.mockImplementationOnce(makeError('conn failed', 'boom') as never);
    const result = await listUsers('mydb');
    expect(result.ok).toBe(false);
    expect(result.users).toEqual([]);
  });
});

describe('hashPassword', () => {
  it('returns the trimmed hash on success', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('$pbkdf2-sha512$hash') as never);
    expect(await hashPassword('secret', '/venv/bin/python3')).toEqual({ ok: true, hash: '$pbkdf2-sha512$hash' });
  });

  it('ok=false when passlib returns an empty hash', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('   ') as never);
    const result = await hashPassword('secret', '/venv/bin/python3');
    expect(result.ok).toBe(false);
  });

  it('ok=false when the python process fails', async () => {
    mockExecFile.mockImplementationOnce(makeError('no passlib', 'ModuleNotFoundError') as never);
    expect((await hashPassword('secret', '/venv/bin/python3')).ok).toBe(false);
  });
});

describe('setUserLogin / setUserPassword / setUserActive', () => {
  it('setUserLogin: escapes single quotes and succeeds', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('') as never);
    expect(await setUserLogin('mydb', 5, "o'brien")).toEqual({ ok: true });
    const call = mockExecFile.mock.calls[0]!;
    expect(call[1]).toContain("UPDATE res_users SET login = 'o''brien' WHERE id = 5");
  });

  it('setUserPassword: ok=true on success', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('') as never);
    expect(await setUserPassword('mydb', 5, 'hashvalue')).toEqual({ ok: true });
  });

  it('setUserActive: ok=false on failure', async () => {
    mockExecFile.mockImplementationOnce(makeError('conn failed', 'boom') as never);
    expect((await setUserActive('mydb', 5, false)).ok).toBe(false);
  });
});

// ── spawn-backed streaming functions ─────────────────────────────────────────

describe('extractZip', () => {
  it('resolves ok=true and streams unzip output lines', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const lines: string[] = [];
    const promise = extractZip('/x.zip', '/dest', l => lines.push(l));
    await writeAndFlush(proc.stdout, '  inflating: dest/foo.sql  \n');
    await closeProc(proc, 0);
    expect(await promise).toEqual({ ok: true });
    expect(lines).toEqual(['inflating: dest/foo.sql']);
  });

  it('resolves ok=false with stderr on failure', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = extractZip('/x.zip', '/dest', () => {});
    await writeAndFlush(proc.stderr, 'End-of-central-directory signature not found\n');
    await closeProc(proc, 1);
    expect(await promise).toEqual({ ok: false, error: 'End-of-central-directory signature not found' });
  });
});

describe('spawnPsqlRestore', () => {
  it('resolves ok=true on a clean restore', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = spawnPsqlRestore('mydb', '/dump.sql', () => {});
    await closeProc(proc, 0);
    expect(await promise).toEqual({ ok: true });
    expect(mockSpawn).toHaveBeenCalledWith('psql', expect.arrayContaining(['--dbname', 'mydb', '--file', '/dump.sql']));
  });

  it('resolves ok=false with the collected stderr on failure', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = spawnPsqlRestore('mydb', '/dump.sql', () => {});
    await writeAndFlush(proc.stderr, 'ERROR:  relation already exists\n');
    await closeProc(proc, 3);
    expect(await promise).toEqual({ ok: false, error: 'ERROR:  relation already exists' });
  });
});

function fakeVersionDir(name: string) {
  return { name, isDirectory: () => true } as unknown as import('fs').Dirent;
}

describe('findLatestPgRestoreBinary', () => {
  it('returns the newest version whose binary is present and executable', async () => {
    mockReaddir.mockResolvedValueOnce([fakeVersionDir('14'), fakeVersionDir('17')] as never);
    mockAccess.mockResolvedValueOnce(undefined); // first candidate checked (17) succeeds
    const binary = await findLatestPgRestoreBinary();
    expect(binary).toBe('/usr/lib/postgresql/17/bin/pg_restore');
  });

  it('skips a version whose binary is missing/not executable and falls back to the next', async () => {
    mockReaddir.mockResolvedValueOnce([fakeVersionDir('14'), fakeVersionDir('17')] as never);
    mockAccess
      .mockRejectedValueOnce(new Error('ENOENT')) // 17 missing
      .mockResolvedValueOnce(undefined);          // 14 present
    const binary = await findLatestPgRestoreBinary();
    expect(binary).toBe('/usr/lib/postgresql/14/bin/pg_restore');
  });

  it('ignores non-numeric directory names', async () => {
    mockReaddir.mockResolvedValueOnce([fakeVersionDir('common'), fakeVersionDir('16')] as never);
    mockAccess.mockResolvedValueOnce(undefined);
    const binary = await findLatestPgRestoreBinary();
    expect(binary).toBe('/usr/lib/postgresql/16/bin/pg_restore');
  });

  it('falls back to the bare command when /usr/lib/postgresql does not exist (e.g. macOS)', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
    expect(await findLatestPgRestoreBinary()).toBe('pg_restore');
  });

  it('falls back to the bare command when no candidate binary is accessible', async () => {
    mockReaddir.mockResolvedValueOnce([fakeVersionDir('14'), fakeVersionDir('17')] as never);
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    expect(await findLatestPgRestoreBinary()).toBe('pg_restore');
  });
});

describe('spawnPgRestore', () => {
  it('adds -j <jobs> only when jobs > 1', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT')); // => falls back to bare 'pg_restore'
    const proc1 = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc1));
    const promise1 = spawnPgRestore('mydb', '/d.dump', () => {}, 1);
    await waitUntil(() => mockSpawn.mock.calls.length > 0);
    await closeProc(proc1, 0);
    await promise1;
    expect(mockSpawn).toHaveBeenCalledWith('pg_restore', expect.not.arrayContaining(['-j']));

    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
    // jobs > 1 triggers the version-mismatch check (getDumpPgVersion, getServerVersion);
    // make both fail so resolveSafeJobCount fails open and keeps jobs=4 unchanged.
    mockExecFile
      .mockImplementationOnce(makeError('pg_restore not found') as never)
      .mockImplementationOnce(makeError('psql not found') as never);
    const proc2 = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc2));
    const promise2 = spawnPgRestore('mydb', '/d.dump', () => {}, 4);
    await waitUntil(() => mockSpawn.mock.calls.length > 1);
    await closeProc(proc2, 0);
    await promise2;
    expect(mockSpawn).toHaveBeenCalledWith('pg_restore', expect.arrayContaining(['-j', '4']));
  });

  it('uses the resolved newest pg_restore binary instead of the bare command', async () => {
    mockReaddir.mockResolvedValueOnce([fakeVersionDir('14'), fakeVersionDir('17')] as never);
    mockAccess.mockResolvedValueOnce(undefined);
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = spawnPgRestore('mydb', '/d.dump', () => {});
    await waitUntil(() => mockSpawn.mock.calls.length > 0);
    await closeProc(proc, 0);
    await promise;
    expect(mockSpawn).toHaveBeenCalledWith('/usr/lib/postgresql/17/bin/pg_restore', expect.any(Array));
  });

  it('falls back to a single job when the dump is from a newer PostgreSQL major version than the server', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT')); // binary resolution => bare 'pg_restore'
    mockExecFile
      .mockImplementationOnce(makeSuccess('Dumped by pg_dump version: 16.15 (Debian 16.15-1.pgdg11+2)') as never)
      .mockImplementationOnce(makeSuccess('140024') as never); // server_version_num for 14.24
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const lines: string[] = [];
    const promise = spawnPgRestore('mydb', '/d.dump', l => lines.push(l), 4);
    await waitUntil(() => mockSpawn.mock.calls.length > 0);
    await closeProc(proc, 0);
    await promise;
    expect(mockSpawn).toHaveBeenCalledWith('pg_restore', expect.not.arrayContaining(['-j']));
    expect(lines.some(l => l.includes('séquentielle'))).toBe(true);
  });

  it('passes --verbose so progress is streamed, but only keeps error-looking lines in the failure summary', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const lines: string[] = [];
    const promise = spawnPgRestore('mydb', '/d.dump', l => lines.push(l));
    await waitUntil(() => mockSpawn.mock.calls.length > 0);
    expect(mockSpawn).toHaveBeenCalledWith('pg_restore', expect.arrayContaining(['--verbose']));

    await writeAndFlush(proc.stderr, 'pg_restore: création de TABLE "public.res_partner"\n');
    await writeAndFlush(proc.stderr, 'pg_restore: traitement des données de la table "public.res_partner"\n');
    await writeAndFlush(proc.stderr, 'pg_restore: erreur : could not execute query: ERROR: relation already exists\n');
    await closeProc(proc, 1);

    const result = await promise;
    // every line, including routine progress, reaches the live log callback
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('création de TABLE'),
      expect.stringContaining('traitement des données'),
      expect.stringContaining('relation already exists'),
    ]));
    // but the failure summary only contains the genuine error line
    expect(result).toEqual({ ok: false, error: expect.stringContaining('relation already exists') as unknown as string });
    expect((result as { error: string }).error).not.toContain('création de TABLE');
  });

  it('does not misclassify a column literally named "error" as a failure line', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = spawnPgRestore('mydb', '/d.dump', () => {});
    await waitUntil(() => mockSpawn.mock.calls.length > 0);
    await writeAndFlush(proc.stderr, 'pg_restore: création de COMMENT « public.COLUMN account_edi_document.error »\n');
    await closeProc(proc, 0);
    expect(await promise).toEqual({ ok: true });
  });

  it('resolves ok=true when every captured error is the known-harmless cross-version GUC mismatch', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = spawnPgRestore('mydb', '/d.dump', () => {});
    await waitUntil(() => mockSpawn.mock.calls.length > 0);
    await writeAndFlush(
      proc.stderr,
      'pg_restore: erreur : could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"\n',
    );
    await closeProc(proc, 1);
    expect(await promise).toEqual({ ok: true });
  });

  it('still resolves ok=false when a real error is mixed in with the benign GUC one', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = spawnPgRestore('mydb', '/d.dump', () => {});
    await waitUntil(() => mockSpawn.mock.calls.length > 0);
    await writeAndFlush(
      proc.stderr,
      'pg_restore: erreur : could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"\n',
    );
    await writeAndFlush(proc.stderr, 'pg_restore: erreur : could not execute query: ERROR: syntax error\n');
    await closeProc(proc, 1);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain('syntax error');
  });
});

describe('getDumpPgVersion', () => {
  it('extracts the major version from the pg_restore --list header', async () => {
    mockExecFile.mockImplementationOnce(
      makeSuccess('Dumped by pg_dump version: 16.15 (Debian 16.15-1.pgdg11+2)') as never,
    );
    expect(await getDumpPgVersion('/d.dump', 'pg_restore')).toBe(16);
  });

  it('returns null when the header has no matching line', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('nothing relevant here') as never);
    expect(await getDumpPgVersion('/d.dump', 'pg_restore')).toBeNull();
  });

  it('returns null when pg_restore fails', async () => {
    mockExecFile.mockImplementationOnce(makeError('not a valid archive') as never);
    expect(await getDumpPgVersion('/d.dump', 'pg_restore')).toBeNull();
  });
});

describe('getServerVersion', () => {
  it('parses the major version from server_version_num', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('140024') as never);
    expect(await getServerVersion()).toBe(14);
  });

  it('returns null on malformed output', async () => {
    mockExecFile.mockImplementationOnce(makeSuccess('not a number') as never);
    expect(await getServerVersion()).toBeNull();
  });

  it('returns null when psql fails', async () => {
    mockExecFile.mockImplementationOnce(makeError('connection refused') as never);
    expect(await getServerVersion()).toBeNull();
  });
});

describe('resolveSafeJobCount', () => {
  it('returns the requested job count unchanged when jobs <= 1, without checking versions', async () => {
    const jobs = await resolveSafeJobCount(1, '/d.dump', 'pg_restore', () => {});
    expect(jobs).toBe(1);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('falls back to 1 when the dump version is newer than the server version', async () => {
    mockExecFile
      .mockImplementationOnce(makeSuccess('Dumped by pg_dump version: 16.15') as never)
      .mockImplementationOnce(makeSuccess('140024') as never);
    const lines: string[] = [];
    const jobs = await resolveSafeJobCount(4, '/d.dump', 'pg_restore', l => lines.push(l));
    expect(jobs).toBe(1);
    expect(lines.length).toBe(1);
  });

  it('keeps the requested job count when versions are compatible', async () => {
    mockExecFile
      .mockImplementationOnce(makeSuccess('Dumped by pg_dump version: 14.5') as never)
      .mockImplementationOnce(makeSuccess('140024') as never);
    const jobs = await resolveSafeJobCount(4, '/d.dump', 'pg_restore', () => {});
    expect(jobs).toBe(4);
  });

  it('fails open (keeps the requested job count) when a version cannot be determined', async () => {
    mockExecFile
      .mockImplementationOnce(makeError('pg_restore not found') as never)
      .mockImplementationOnce(makeSuccess('140024') as never);
    const jobs = await resolveSafeJobCount(4, '/d.dump', 'pg_restore', () => {});
    expect(jobs).toBe(4);
  });
});

describe('spawnMigration', () => {
  it('resolves ok=true on a clean exit with no ERROR lines', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = spawnMigration('mydb', '18.0', 'test', undefined, () => {});
    await closeProc(proc, 0);
    expect(await promise).toEqual({ ok: true });
  });

  it('includes --contract when an enterprise code is given', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = spawnMigration('mydb', '18.0', 'production', 'ENT-CODE', () => {});
    await closeProc(proc, 0);
    await promise;
    const call = mockSpawn.mock.calls[0]!;
    expect(call[1]).toEqual(['-c', expect.stringContaining('--contract ENT-CODE')]);
  });

  it('a detected "ERROR:" line in the output wins over a 0 exit code', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = spawnMigration('mydb', '18.0', 'test', undefined, () => {});
    await writeAndFlush(proc.stdout, '2027-01-15 10:00:00 ERROR: something went wrong\n');
    await closeProc(proc, 0);
    expect(await promise).toEqual({ ok: false, error: 'something went wrong' });
  });

  it('exposes a stdin writer via onStdinReady', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    let writer: ((s: string) => void) | undefined;
    const promise = spawnMigration('mydb', '18.0', 'test', undefined, () => {}, w => { writer = w; });
    expect(writer).toBeInstanceOf(Function);
    const spy = vi.spyOn(proc.stdin, 'write');
    writer!('y\n');
    expect(spy).toHaveBeenCalledWith('y\n');
    await closeProc(proc, 0);
    await promise;
  });
});

describe('spawnNeutralize', () => {
  it('resolves ok=true on a clean exit, passing --addons-path=<value> as a single token before the neutralize subcommand', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = spawnNeutralize('mydb', '/versions/17.0', ['/versions/17.0/community/addons', '/versions/17.0/enterprise']);
    await closeProc(proc, 0);
    expect(await promise).toEqual({ ok: true });
    expect(mockSpawn).toHaveBeenCalledWith(
      join('/versions/17.0', '.venv', 'bin', 'python3'),
      [
        join('/versions/17.0', 'community', 'odoo-bin'),
        '--addons-path=/versions/17.0/community/addons,/versions/17.0/enterprise',
        'neutralize', '-d', 'mydb',
      ],
    );
  });

  it('resolves ok=false with stderr on failure', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = spawnNeutralize('mydb', '/versions/17.0', ['/versions/17.0/community/addons']);
    await writeAndFlush(proc.stderr, 'Traceback...\n');
    await closeProc(proc, 1);
    const result = await promise;
    expect(result.ok).toBe(false);
  });
});
