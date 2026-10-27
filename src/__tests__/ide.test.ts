import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, mkdir: vi.fn(actual.mkdir) };
});
vi.mock('child_process');

import { mkdir } from 'fs/promises';
import { spawn } from 'child_process';
import { setupVsCode, type IdeStepId, type IdeStepStatus } from '../services/ide.js';
import { makeFakeProc, asChildProcess, waitUntil } from './helpers/fakeChildProcess.js';

const mockMkdir = vi.mocked(mkdir);
const mockSpawn = vi.mocked(spawn);

let root: string;
let steps: { id: IdeStepId; status: IdeStepStatus; detail?: string }[];
const onStep = (id: IdeStepId, status: IdeStepStatus, detail?: string) => steps.push({ id, status, detail });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nupo-ide-test-'));
  steps = [];
  vi.clearAllMocks();
  mockSpawn.mockReturnValue(asChildProcess(makeFakeProc())); // 'code' never actually launches
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function settingsPath(): string {
  return join(root, '.vscode', 'settings.json');
}

describe('setupVsCode', () => {
  it('creates .vscode/settings.json with the required defaults when absent', async () => {
    const ok = await setupVsCode({ branch: '17.0', path: root }, onStep);
    expect(ok).toBe(true);
    const content = JSON.parse(await readFile(settingsPath(), 'utf-8'));
    expect(content['python.defaultInterpreterPath']).toBe('${workspaceFolder}/.venv/bin/python');
    expect(content['python.analysis.diagnosticMode']).toBe('openFilesOnly');
    expect(content['search.exclude']['datas']).toBe(true);
    expect(steps.find(s => s.id === 'settings_json' && s.status === 'success')?.detail).toBe('créé');
  });

  it('adds only missing top-level and nested keys, never overwriting existing ones', async () => {
    await mkdir(join(root, '.vscode'), { recursive: true });
    await writeFile(settingsPath(), JSON.stringify({
      'python.defaultInterpreterPath': '/custom/python',
      'search.exclude': { '**/node_modules': true },
    }, null, 2), 'utf-8');

    const ok = await setupVsCode({ branch: '17.0', path: root }, onStep);
    expect(ok).toBe(true);

    const content = JSON.parse(await readFile(settingsPath(), 'utf-8'));
    expect(content['python.defaultInterpreterPath']).toBe('/custom/python'); // untouched
    expect(content['search.exclude']['**/node_modules']).toBe(true);        // untouched
    expect(content['search.exclude']['datas']).toBe(true);                  // merged in
    expect(content['python.analysis.diagnosticMode']).toBe('openFilesOnly'); // added (missing key)
    expect(steps.filter(s => s.id === 'settings_json').at(-1)?.detail).toBe('mis à jour');
  });

  it('leaves settings.json untouched and reports success when every key is already present', async () => {
    await mkdir(join(root, '.vscode'), { recursive: true });
    const full = {
      'python.defaultInterpreterPath': '${workspaceFolder}/.venv/bin/python',
      'python.terminal.activateEnvironment': true,
      'python.analysis.diagnosticMode': 'openFilesOnly',
      'files.exclude': { '**/__pycache__': true },
      'search.exclude': { '**/__pycache__': true, '**/*.pyc': true, '**/*.log': true, 'datas': true, 'dumps': true },
      'files.watcherExclude': { '**/__pycache__/**': true, '**/*.pyc': true, 'venv/**': true, 'datas/**': true, 'dumps/**': true },
    };
    await writeFile(settingsPath(), JSON.stringify(full, null, 4), 'utf-8');

    const ok = await setupVsCode({ branch: '17.0', path: root }, onStep);
    expect(ok).toBe(true);
    expect(steps.filter(s => s.id === 'settings_json').at(-1)?.detail).toBe('existant');
  });

  it('preserves comments and formatting when merging into a JSONC file', async () => {
    await mkdir(join(root, '.vscode'), { recursive: true });
    const jsonc = `{\n  // my custom interpreter\n  "python.defaultInterpreterPath": "/custom/python"\n}\n`;
    await writeFile(settingsPath(), jsonc, 'utf-8');

    const ok = await setupVsCode({ branch: '17.0', path: root }, onStep);
    expect(ok).toBe(true);
    const raw = await readFile(settingsPath(), 'utf-8');
    expect(raw).toContain('// my custom interpreter');
  });

  it('leaves an unparsable settings.json untouched and still succeeds', async () => {
    await mkdir(join(root, '.vscode'), { recursive: true });
    const broken = '{ not valid json !!';
    await writeFile(settingsPath(), broken, 'utf-8');

    const ok = await setupVsCode({ branch: '17.0', path: root }, onStep);
    expect(ok).toBe(true);
    expect(await readFile(settingsPath(), 'utf-8')).toBe(broken);
    expect(steps.filter(s => s.id === 'settings_json').at(-1)?.detail).toBe('existant, non modifiable');
  });

  it('stops after step 1 and returns false when mkdir fails', async () => {
    mockMkdir.mockRejectedValueOnce(new Error('EACCES: permission denied'));
    const ok = await setupVsCode({ branch: '17.0', path: root }, onStep);
    expect(ok).toBe(false);
    expect(new Set(steps.map(s => s.id))).toEqual(new Set(['vscode_dir']));
    expect(steps.at(-1)!.status).toBe('error');
  });

  it('reports open_vscode error and returns false when the "code" binary is not found', async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValueOnce(asChildProcess(proc));
    const promise = setupVsCode({ branch: '17.0', path: root }, onStep);
    await waitUntil(() => mockSpawn.mock.calls.length > 0);
    proc.emit('error', new Error('spawn code ENOENT'));
    const ok = await promise;
    expect(ok).toBe(false);
    const openStep = steps.filter(s => s.id === 'open_vscode').at(-1);
    expect(openStep?.status).toBe('error');
    expect(openStep?.detail).toContain('PATH');
  });
});
