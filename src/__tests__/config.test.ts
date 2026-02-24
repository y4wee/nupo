import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  configExists,
  readConfig,
  writeConfig,
  patchConfig,
  getConfigPath,
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

  it('readConfig: parses existing JSON', async () => {
    const saved: NupoConfig = {
      initiated: true,
      python_installed: true,
      pip_installed: false,
      odoo_path_repo: '/home/user/odoo',
      odoo_versions: { '17.0': { branch: '17.0', path: '/home/user/odoo/17.0' } },
    };
    await writeConfig(saved);
    const cfg = await readConfig();
    expect(cfg).toEqual(saved);
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
});
