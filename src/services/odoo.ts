import { join } from 'path';
import { OdooServiceConfig } from '../types/index.js';

export function buildAddonsPaths(service: OdooServiceConfig): string[] {
  const paths = [join(service.versionPath, 'community', 'addons')];
  if (service.useEnterprise) {
    paths.push(join(service.versionPath, 'enterprise'));
    paths.push(join(service.versionPath, 'themes'));
  }
  for (const f of service.customFolders) paths.push(join(service.versionPath, 'custom', f));
  return paths;
}

export interface LaunchOpts {
  shell: boolean;
  db: string;
  module: string;
  install: string;
  stopAfterInit: boolean;
  noHttp: boolean;
  devFeatures: string[];
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
  if (opts.module)        args.push('-u', opts.module);
  if (opts.install)       args.push('-i', opts.install);
  if (opts.stopAfterInit) args.push('--stop-after-init');
  if (opts.noHttp)        args.push('--no-http');
  if (opts.devFeatures.length > 0) args.push('--dev', opts.devFeatures.join(','));

  return { cmd: python, args };
}
