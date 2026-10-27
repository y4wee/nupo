import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanManifestDependencies } from '../services/manifest.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nupo-manifest-test-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeManifest(modulePath: string, content: string): Promise<void> {
  await mkdir(modulePath, { recursive: true });
  await writeFile(join(modulePath, '__manifest__.py'), content, 'utf-8');
}

describe('scanManifestDependencies', () => {
  it('returns no deps and manifestCount=0 when the directory does not exist', async () => {
    const result = await scanManifestDependencies(join(root, 'does-not-exist'));
    expect(result).toEqual({ deps: [], manifestCount: 0 });
  });

  it('returns no deps when a module has no external_dependencies', async () => {
    await writeManifest(join(root, 'mod_a'), `{\n    'name': 'Mod A',\n}\n`);
    const result = await scanManifestDependencies(root);
    expect(result).toEqual({ deps: [], manifestCount: 1 });
  });

  it('extracts python deps with double quotes', async () => {
    await writeManifest(join(root, 'mod_a'), `{
    "name": "Mod A",
    "external_dependencies": {
        "python": ["qrcode", "phonenumbers"],
    },
}
`);
    const result = await scanManifestDependencies(root);
    expect(result.deps).toEqual(['phonenumbers', 'qrcode']);
    expect(result.manifestCount).toBe(1);
  });

  it('extracts python deps with single quotes', async () => {
    await writeManifest(join(root, 'mod_a'), `{
    'name': 'Mod A',
    'external_dependencies': {
        'python': ['xlrd'],
    },
}
`);
    const result = await scanManifestDependencies(root);
    expect(result.deps).toEqual(['xlrd']);
  });

  it('de-duplicates and sorts deps across multiple modules', async () => {
    await writeManifest(join(root, 'mod_a'), `{'external_dependencies': {'python': ['zebra', 'qrcode']}}`);
    await writeManifest(join(root, 'mod_b'), `{'external_dependencies': {'python': ['qrcode', 'apple']}}`);
    const result = await scanManifestDependencies(root);
    expect(result.deps).toEqual(['apple', 'qrcode', 'zebra']);
    expect(result.manifestCount).toBe(2);
  });

  it('finds manifests nested in subdirectories', async () => {
    await writeManifest(join(root, 'nested', 'deep', 'mod_a'), `{'external_dependencies': {'python': ['foo']}}`);
    const result = await scanManifestDependencies(root);
    expect(result.deps).toEqual(['foo']);
    expect(result.manifestCount).toBe(1);
  });

  it('skips a module whose manifest has no python key in external_dependencies', async () => {
    await writeManifest(join(root, 'mod_a'), `{'external_dependencies': {'bin': ['wkhtmltopdf']}}`);
    const result = await scanManifestDependencies(root);
    expect(result.deps).toEqual([]);
    expect(result.manifestCount).toBe(1);
  });

  it('ignores files that are not named __manifest__.py', async () => {
    await mkdir(join(root, 'mod_a'), { recursive: true });
    await writeFile(join(root, 'mod_a', '__init__.py'), `import foo`, 'utf-8');
    const result = await scanManifestDependencies(root);
    expect(result.manifestCount).toBe(0);
  });
});
