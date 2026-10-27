import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  discoverServices,
  buildServiceConfig,
  buildAddonsPaths,
  buildDefaultAddonsPaths,
  buildLaunchCmd,
  parseCustomOverride,
  findMissingCustomPath,
  dirExists,
} from '../services/odoo.js';
import type { NupoConfig, OdooVersion } from '../types/index.js';

let root: string;
let versionPath: string;
const version: OdooVersion = { branch: '17.0', path: '' };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nupo-odoo-test-'));
  versionPath = join(root, '17.0');
  version.path = versionPath;
  await mkdir(join(versionPath, 'community', 'addons'), { recursive: true });
  await mkdir(join(versionPath, 'config'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('parseCustomOverride', () => {
  it('splits on commas, trims whitespace, drops empties', () => {
    expect(parseCustomOverride('a, b ,, c')).toEqual(['a', 'b', 'c']);
  });
  it('returns an empty array for an empty string', () => {
    expect(parseCustomOverride('')).toEqual([]);
  });
});

describe('dirExists', () => {
  it('true for an existing directory', async () => {
    expect(await dirExists(versionPath)).toBe(true);
  });
  it('false for a missing path', async () => {
    expect(await dirExists(join(versionPath, 'nope'))).toBe(false);
  });
  it('false for a file (not a directory)', async () => {
    const filePath = join(versionPath, 'config', 'x.conf');
    await writeFile(filePath, '', 'utf-8');
    expect(await dirExists(filePath)).toBe(false);
  });
});

describe('findMissingCustomPath', () => {
  it('returns null when raw is empty', async () => {
    expect(await findMissingCustomPath('', versionPath)).toBeNull();
  });
  it('returns null when every path exists (relative, resolved against versionPath)', async () => {
    await mkdir(join(versionPath, 'custom', 'a'), { recursive: true });
    expect(await findMissingCustomPath('custom/a', versionPath)).toBeNull();
  });
  it('resolves absolute paths as-is', async () => {
    const abs = join(root, 'elsewhere');
    await mkdir(abs, { recursive: true });
    expect(await findMissingCustomPath(abs, versionPath)).toBeNull();
  });
  it('returns the first missing path among several', async () => {
    await mkdir(join(versionPath, 'custom', 'a'), { recursive: true });
    const missing = await findMissingCustomPath('custom/a, custom/b', versionPath);
    expect(missing).toBe(join(versionPath, 'custom', 'b'));
  });
});

describe('buildServiceConfig', () => {
  it('detects useEnterprise from the enterprise/ directory', async () => {
    await mkdir(join(versionPath, 'enterprise'), { recursive: true });
    const svc = await buildServiceConfig(version, join(versionPath, 'config', 'shop.conf'), '');
    expect(svc.name).toBe('shop');
    expect(svc.useEnterprise).toBe(true);
    expect(svc.branch).toBe('17.0');
  });

  it('falls back to the conventional custom/<name> folder when there is no override', async () => {
    await mkdir(join(versionPath, 'custom', 'shop'), { recursive: true });
    const svc = await buildServiceConfig(version, join(versionPath, 'config', 'shop.conf'), '');
    expect(svc.customAddonsPaths).toEqual([join(versionPath, 'custom', 'shop')]);
    expect(svc.rawCustomOverride).toBe('');
  });

  it('has no custom path when neither override nor conventional folder exist', async () => {
    const svc = await buildServiceConfig(version, join(versionPath, 'config', 'shop.conf'), '');
    expect(svc.customAddonsPaths).toEqual([]);
  });

  it('uses the override instead of the conventional folder, even if both exist', async () => {
    await mkdir(join(versionPath, 'custom', 'shop'), { recursive: true });
    const svc = await buildServiceConfig(version, join(versionPath, 'config', 'shop.conf'), 'custom/other');
    expect(svc.customAddonsPaths).toEqual([join(versionPath, 'custom', 'other')]);
    expect(svc.rawCustomOverride).toBe('custom/other');
  });

  it('resolves a comma-separated override into multiple paths', async () => {
    const svc = await buildServiceConfig(version, join(versionPath, 'config', 'shop.conf'), 'custom/a, custom/b');
    expect(svc.customAddonsPaths).toEqual([
      join(versionPath, 'custom', 'a'),
      join(versionPath, 'custom', 'b'),
    ]);
  });
});

describe('discoverServices', () => {
  it('returns an empty list when a version has no config/ directory', async () => {
    const noConfigPath = join(root, '18.0');
    await mkdir(noConfigPath, { recursive: true });
    const config: NupoConfig = {
      initiated: true, python_installed: true, pip_installed: true, odoo_path_repo: root,
      odoo_versions: { '18.0': { branch: '18.0', path: noConfigPath } },
    };
    expect(await discoverServices(config)).toEqual([]);
  });

  it('ignores non-.conf files and sorts by name', async () => {
    await writeFile(join(versionPath, 'config', 'zeta.conf'), '', 'utf-8');
    await writeFile(join(versionPath, 'config', 'alpha.conf'), '', 'utf-8');
    await writeFile(join(versionPath, 'config', 'README.md'), '', 'utf-8');
    const config: NupoConfig = {
      initiated: true, python_installed: true, pip_installed: true, odoo_path_repo: root,
      odoo_versions: { '17.0': version },
    };
    const services = await discoverServices(config);
    expect(services.map(s => s.name)).toEqual(['alpha', 'zeta']);
  });

  it('applies odoo_service_overrides keyed by confPath', async () => {
    const confPath = join(versionPath, 'config', 'shop.conf');
    await writeFile(confPath, '', 'utf-8');
    const abs = join(root, 'external-custom');
    await mkdir(abs, { recursive: true });
    const config: NupoConfig = {
      initiated: true, python_installed: true, pip_installed: true, odoo_path_repo: root,
      odoo_versions: { '17.0': version },
      odoo_service_overrides: { [confPath]: abs },
    };
    const [svc] = await discoverServices(config);
    expect(svc!.customAddonsPaths).toEqual([abs]);
  });

  it('aggregates services across multiple versions', async () => {
    await writeFile(join(versionPath, 'config', 'shop.conf'), '', 'utf-8');
    const v18Path = join(root, '18.0');
    await mkdir(join(v18Path, 'config'), { recursive: true });
    await writeFile(join(v18Path, 'config', 'blog.conf'), '', 'utf-8');
    const config: NupoConfig = {
      initiated: true, python_installed: true, pip_installed: true, odoo_path_repo: root,
      odoo_versions: { '17.0': version, '18.0': { branch: '18.0', path: v18Path } },
    };
    const services = await discoverServices(config);
    expect(services.map(s => s.name).sort()).toEqual(['blog', 'shop']);
  });
});

describe('buildAddonsPaths', () => {
  it('always includes community/addons', () => {
    const paths = buildAddonsPaths({
      name: 'shop', branch: '17.0', versionPath, confPath: '',
      useEnterprise: false, customAddonsPaths: [], rawCustomOverride: '',
    });
    expect(paths).toEqual([join(versionPath, 'community', 'addons')]);
  });

  it('adds enterprise + themes when useEnterprise is true', () => {
    const paths = buildAddonsPaths({
      name: 'shop', branch: '17.0', versionPath, confPath: '',
      useEnterprise: true, customAddonsPaths: [], rawCustomOverride: '',
    });
    expect(paths).toContain(join(versionPath, 'enterprise'));
    expect(paths).toContain(join(versionPath, 'themes'));
  });

  it('adds industry only when the directory actually exists on disk', async () => {
    const service = {
      name: 'shop', branch: '17.0', versionPath, confPath: '',
      useEnterprise: false, customAddonsPaths: [], rawCustomOverride: '',
    };
    expect(buildAddonsPaths(service)).not.toContain(join(versionPath, 'industry'));
    await mkdir(join(versionPath, 'industry'), { recursive: true });
    expect(buildAddonsPaths(service)).toContain(join(versionPath, 'industry'));
  });

  it('appends every custom addons path', () => {
    const paths = buildAddonsPaths({
      name: 'shop', branch: '17.0', versionPath, confPath: '',
      useEnterprise: false, customAddonsPaths: ['/a', '/b'], rawCustomOverride: '',
    });
    expect(paths.slice(-2)).toEqual(['/a', '/b']);
  });
});

describe('buildDefaultAddonsPaths', () => {
  it('always includes community/addons and excludes enterprise/themes when useEnterprise is false', () => {
    expect(buildDefaultAddonsPaths(versionPath, false)).toEqual([join(versionPath, 'community', 'addons')]);
  });

  it('adds enterprise + themes when useEnterprise is true', () => {
    const paths = buildDefaultAddonsPaths(versionPath, true);
    expect(paths).toContain(join(versionPath, 'enterprise'));
    expect(paths).toContain(join(versionPath, 'themes'));
  });

  it('adds industry only when the directory actually exists on disk', async () => {
    expect(buildDefaultAddonsPaths(versionPath, false)).not.toContain(join(versionPath, 'industry'));
    await mkdir(join(versionPath, 'industry'), { recursive: true });
    expect(buildDefaultAddonsPaths(versionPath, false)).toContain(join(versionPath, 'industry'));
  });

  it('never includes any custom addons path (unlike buildAddonsPaths)', () => {
    expect(buildDefaultAddonsPaths(versionPath, true).some(p => p.includes('custom'))).toBe(false);
  });
});

describe('buildLaunchCmd', () => {
  let service: ReturnType<typeof buildService>;
  function buildService() {
    return {
      name: 'shop', branch: '17.0', versionPath, confPath: join(versionPath, 'config', 'shop.conf'),
      useEnterprise: false, customAddonsPaths: [] as string[], rawCustomOverride: '',
    };
  }
  beforeEach(() => { service = buildService(); });

  it('builds the base command with -c and --addons-path', () => {
    const { cmd, args } = buildLaunchCmd(service, {
      shell: false, db: '', module: '', install: '', stopAfterInit: false, noHttp: false, devFeatures: [],
    });
    expect(cmd).toBe(join(versionPath, '.venv', 'bin', 'python3'));
    expect(args[0]).toBe(join(versionPath, 'community', 'odoo-bin'));
    expect(args).toContain('-c');
    expect(args).toContain(service.confPath);
    expect(args).toContain('--addons-path');
  });

  it('prepends "shell" when opts.shell is true', () => {
    const { args } = buildLaunchCmd(service, {
      shell: true, db: '', module: '', install: '', stopAfterInit: false, noHttp: false, devFeatures: [],
    });
    expect(args[1]).toBe('shell');
  });

  it('includes -d/-u/-i/--stop-after-init/--no-http only when provided', () => {
    const { args } = buildLaunchCmd(service, {
      shell: false, db: 'mydb', module: 'sale', install: 'purchase',
      stopAfterInit: true, noHttp: true, devFeatures: [],
    });
    expect(args).toEqual(expect.arrayContaining([
      '-d', 'mydb', '-u', 'sale', '-i', 'purchase', '--stop-after-init', '--no-http',
    ]));
  });

  it('adds --http-port only when httpPort is provided', () => {
    const base = { shell: false, db: '', module: '', install: '', stopAfterInit: false, noHttp: false, devFeatures: [] };
    expect(buildLaunchCmd(service, base).args).not.toContain('--http-port');
    const { args } = buildLaunchCmd(service, { ...base, httpPort: 8099 });
    const idx = args.indexOf('--http-port');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('8099');
  });

  it('joins devFeatures with commas under a single --dev flag', () => {
    const { args } = buildLaunchCmd(service, {
      shell: false, db: '', module: '', install: '', stopAfterInit: false, noHttp: false,
      devFeatures: ['xml', 'reload'],
    });
    const idx = args.indexOf('--dev');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('xml,reload');
  });
});
