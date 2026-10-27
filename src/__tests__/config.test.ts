import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  configExists,
  readConfig,
  writeConfig,
  patchConfig,
  getConfigPath,
  getConfigDir,
  migrateOdooPath,
  getBaseConfPath,
  ensureBaseConf,
  readBaseConf,
} from '../services/config.js';
import { DEFAULT_CONFIG, NupoConfig } from '../types/index.js';

let tmpDir: string;

const BASE_CONFIG: NupoConfig = {
  initiated: false,
  python_installed: false,
  pip_installed: false,
  odoo_path_repo: '',
  odoo_versions: {},
};

describe('config service', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'nupo-test-'));
    process.env['NUPO_CONFIG_DIR'] = tmpDir;
  });

  afterEach(async () => {
    delete process.env['NUPO_CONFIG_DIR'];
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('configExists: false when file is absent', async () => {
    expect(await configExists()).toBe(false);
  });

  it('configExists: true after writeConfig', async () => {
    await writeConfig({ ...BASE_CONFIG, initiated: true, python_installed: true, pip_installed: true, odoo_path_repo: '/tmp/odoo' });
    expect(await configExists()).toBe(true);
  });

  it('readConfig: returns DEFAULT_CONFIG when file is absent', async () => {
    const cfg = await readConfig();
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it('readConfig: parses existing JSON, merged with DEFAULT_CONFIG', async () => {
    const saved: NupoConfig = {
      initiated: true,
      python_installed: true,
      pip_installed: false,
      odoo_path_repo: '/home/user/odoo',
      odoo_versions: { '17.0': { branch: '17.0', path: '/home/user/odoo/17.0' } },
    };
    await writeConfig(saved);
    const cfg = await readConfig();
    expect(cfg).toEqual({ ...DEFAULT_CONFIG, ...saved });
  });

  it('writeConfig: creates directory if absent and writes valid JSON', async () => {
    await writeConfig(BASE_CONFIG);
    const raw = await readFile(getConfigPath(), 'utf-8');
    expect(JSON.parse(raw)).toEqual(BASE_CONFIG);
  });

  it('patchConfig: merges without overwriting other keys', async () => {
    await writeConfig({ ...BASE_CONFIG, python_installed: true });
    await patchConfig({ pip_installed: true });
    const cfg = await readConfig();
    expect(cfg.python_installed).toBe(true);
    expect(cfg.pip_installed).toBe(true);
    expect(cfg.initiated).toBe(false);
    expect(cfg.odoo_versions).toEqual({});
  });

  it('getConfigDir: honors NUPO_CONFIG_DIR', () => {
    expect(getConfigDir()).toBe(join(tmpDir, '.nupo'));
  });
});

describe('migrateOdooPath', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'nupo-test-'));
    process.env['NUPO_CONFIG_DIR'] = tmpDir;
  });

  afterEach(async () => {
    delete process.env['NUPO_CONFIG_DIR'];
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('rewrites odoo_versions, odoo_service_overrides and pending_installs paths', async () => {
    const oldRoot = '/old/odoo';
    const newRoot = '/new/odoo';
    await writeConfig({
      ...BASE_CONFIG,
      odoo_path_repo: oldRoot,
      odoo_versions: { '17.0': { branch: '17.0', path: `${oldRoot}/17.0` } },
      odoo_service_overrides: { [`${oldRoot}/17.0/config/shop.conf`]: 'custom/shop' },
      pending_installs: { '18.0': { branch: '18.0', path: `${oldRoot}/18.0`, lastCompletedStep: null } },
    });

    await migrateOdooPath(oldRoot, newRoot);
    const cfg = await readConfig();

    expect(cfg.odoo_path_repo).toBe(newRoot);
    expect(cfg.odoo_versions['17.0']!.path).toBe(`${newRoot}/17.0`);
    expect(cfg.odoo_service_overrides).toEqual({ [`${newRoot}/17.0/config/shop.conf`]: 'custom/shop' });
    expect(cfg.pending_installs!['18.0']!.path).toBe(`${newRoot}/18.0`);
  });

  it('rewrites .vscode/launch.json under each version directory when present', async () => {
    // migrateOdooPath only updates config.json + launch.json *content*; the
    // directory itself is assumed to already have been moved to newRoot by the caller.
    const oldRoot = join(tmpDir, 'old-odoo');
    const newRoot = join(tmpDir, 'new-odoo');
    const oldVersionPath = join(oldRoot, '17.0');
    const newVersionPath = join(newRoot, '17.0');
    await writeConfig({
      ...BASE_CONFIG,
      odoo_path_repo: oldRoot,
      odoo_versions: { '17.0': { branch: '17.0', path: oldVersionPath } },
    });
    await mkdir(join(newVersionPath, '.vscode'), { recursive: true });
    await writeFile(
      join(newVersionPath, '.vscode', 'launch.json'),
      JSON.stringify({ program: `${oldVersionPath}/community/odoo-bin` }),
      'utf-8',
    );

    await migrateOdooPath(oldRoot, newRoot);

    const cfg = await readConfig();
    expect(cfg.odoo_versions['17.0']!.path).toBe(newVersionPath);
    const launchJson = await readFile(join(newVersionPath, '.vscode', 'launch.json'), 'utf-8');
    expect(launchJson).toContain(newVersionPath);
    expect(launchJson).not.toContain(oldRoot);
  });

  it('does not fail when a version has no .vscode/launch.json', async () => {
    const oldRoot = '/old/odoo';
    const newRoot = '/new/odoo';
    await writeConfig({
      ...BASE_CONFIG,
      odoo_path_repo: oldRoot,
      odoo_versions: { '17.0': { branch: '17.0', path: `${oldRoot}/17.0` } },
    });
    await expect(migrateOdooPath(oldRoot, newRoot)).resolves.toBeUndefined();
  });
});

describe('base odoo.conf', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'nupo-test-'));
    process.env['NUPO_CONFIG_DIR'] = tmpDir;
  });

  afterEach(async () => {
    delete process.env['NUPO_CONFIG_DIR'];
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('getBaseConfPath: lives under the config dir', () => {
    expect(getBaseConfPath()).toBe(join(tmpDir, '.nupo', 'odoo_base.conf'));
  });

  it('ensureBaseConf: creates the file with a data_dir derived from versionPath when given', async () => {
    const versionPath = join(tmpDir, 'odoo', '17.0');
    await ensureBaseConf(versionPath);
    const content = await readFile(getBaseConfPath(), 'utf-8');
    expect(content).toContain(`data_dir = ${join(versionPath, 'datas')}`);
  });

  it('ensureBaseConf: is idempotent — never overwrites an existing file', async () => {
    await ensureBaseConf();
    await writeFile(getBaseConfPath(), '[options]\ncustom = true\n', 'utf-8');
    await ensureBaseConf(join(tmpDir, 'other-version'));
    expect(await readFile(getBaseConfPath(), 'utf-8')).toBe('[options]\ncustom = true\n');
  });

  it('readBaseConf: creates the file on first read and returns its content', async () => {
    const content = await readBaseConf();
    expect(content).toContain('[options]');
    expect(content).toContain('db_host = False');
  });
});
