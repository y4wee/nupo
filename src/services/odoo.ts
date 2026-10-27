import { join, isAbsolute, basename } from 'path';
import { existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { NupoConfig, OdooVersion, OdooServiceConfig } from '../types/index.js';

export async function dirExists(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

function resolveServicePath(versionPath: string, p: string): string {
  return isAbsolute(p) ? p : join(versionPath, p);
}

export function parseCustomOverride(raw: string): string[] {
  return raw.split(',').map(p => p.trim()).filter(Boolean);
}

/** Returns the first path in the override that doesn't exist, or null if all do (or raw is empty). */
export async function findMissingCustomPath(raw: string, versionPath: string): Promise<string | null> {
  for (const p of parseCustomOverride(raw)) {
    const resolved = resolveServicePath(versionPath, p);
    if (!(await dirExists(resolved))) return resolved;
  }
  return null;
}

// ── Discovery ───────────────────────────────────────────────────────────────

export async function buildServiceConfig(
  version: OdooVersion,
  confPath: string,
  rawCustomOverride: string,
): Promise<OdooServiceConfig> {
  const name = basename(confPath, '.conf');
  const useEnterprise = await dirExists(join(version.path, 'enterprise'));

  let customAddonsPaths: string[];
  if (rawCustomOverride) {
    customAddonsPaths = parseCustomOverride(rawCustomOverride)
      .map(p => resolveServicePath(version.path, p));
  } else {
    const conventional = join(version.path, 'custom', name);
    customAddonsPaths = (await dirExists(conventional)) ? [conventional] : [];
  }

  return {
    name,
    branch: version.branch,
    versionPath: version.path,
    confPath,
    useEnterprise,
    customAddonsPaths,
    rawCustomOverride,
  };
}

/**
 * Scans <versionPath>/config/*.conf for every installed Odoo version and
 * builds the resulting OdooServiceConfig list. Services are not persisted —
 * only the custom path override survives in config.odoo_service_overrides,
 * keyed by confPath.
 */
export async function discoverServices(config: NupoConfig): Promise<OdooServiceConfig[]> {
  const overrides = config.odoo_service_overrides ?? {};
  const results: OdooServiceConfig[] = [];

  for (const version of Object.values(config.odoo_versions)) {
    const configDir = join(version.path, 'config');
    let entries: string[];
    try {
      entries = (await readdir(configDir)).filter(f => f.endsWith('.conf'));
    } catch {
      continue;
    }

    for (const file of entries) {
      const confPath = join(configDir, file);
      results.push(await buildServiceConfig(version, confPath, overrides[confPath] ?? ''));
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Addons path / launch command ─────────────────────────────────────────────

/** The standard repo addons paths for a version (community, optionally enterprise/themes/industry) — no custom paths. */
export function buildDefaultAddonsPaths(versionPath: string, useEnterprise: boolean): string[] {
  const paths = [join(versionPath, 'community', 'addons')];
  if (useEnterprise) {
    paths.push(join(versionPath, 'enterprise'));
    paths.push(join(versionPath, 'themes'));
  }
  // Industry is independent of enterprise — include it whenever it was cloned.
  const industryPath = join(versionPath, 'industry');
  if (existsSync(industryPath)) paths.push(industryPath);
  return paths;
}

export function buildAddonsPaths(service: OdooServiceConfig): string[] {
  return [
    ...buildDefaultAddonsPaths(service.versionPath, service.useEnterprise),
    ...service.customAddonsPaths,
  ];
}

export interface LaunchOpts {
  shell: boolean;
  db: string;
  module: string;
  install: string;
  stopAfterInit: boolean;
  noHttp: boolean;
  devFeatures: string[];
  httpPort?: number;
}

export function buildLaunchCmd(
  service: OdooServiceConfig,
  opts: LaunchOpts,
): { cmd: string; args: string[] } {
  const python  = join(service.versionPath, '.venv', 'bin', 'python3');
  const odooBin = join(service.versionPath, 'community', 'odoo-bin');
  const args: string[] = [odooBin];

  if (opts.shell) args.push('shell');
  args.push('-c', service.confPath);
  args.push('--addons-path', buildAddonsPaths(service).join(','));
  if (opts.db)            args.push('-d', opts.db);
  if (opts.httpPort)      args.push('--http-port', String(opts.httpPort));
  if (opts.module)        args.push('-u', opts.module);
  if (opts.install)       args.push('-i', opts.install);
  if (opts.stopAfterInit) args.push('--stop-after-init');
  if (opts.noHttp)        args.push('--no-http');
  if (opts.devFeatures.length > 0) args.push('--dev', opts.devFeatures.join(','));

  return { cmd: python, args };
}
