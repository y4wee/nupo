import { createRequire } from 'module';
import { get } from 'node:https';
import { execFileSync, spawn } from 'node:child_process';

const _require = createRequire(import.meta.url);
const { version: currentVersion, name: packageName } = _require('../../package.json') as {
  version: string;
  name: string;
};

function fetchLatestVersion(): Promise<string | null> {
  return new Promise(resolve => {
    const req = get(
      `https://registry.npmjs.org/${packageName}/latest`,
      { headers: { Accept: 'application/json' } },
      res => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data) as { version?: string };
            resolve(json.version ?? null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.setTimeout(3000, () => { req.destroy(); resolve(null); });
  });
}

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.split('.').map(Number) as [number, number, number];
  const [lMaj, lMin, lPatch] = parse(latest);
  const [cMaj, cMin, cPatch] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPatch > cPatch;
}

/** Vérifie si une version plus récente est disponible sur npm. */
export async function checkForUpdate(): Promise<boolean> {
  const latest = await fetchLatestVersion();
  if (!latest) return false;
  return isNewer(latest, currentVersion);
}

/** Lance npm install -g puis respawn le process courant. À appeler après cleanup Ink. */
export function performUpdateAndRestart(): void {
  process.stdout.write('\n  Mise à jour en cours…\n\n');
  try {
    execFileSync('npm', ['install', '-g', packageName], { stdio: 'inherit' });
  } catch {
    process.stdout.write('\n  Échec de la mise à jour.\n');
    process.exit(1);
  }

  process.stdout.write('\n  Redémarrage…\n\n');
  const child = spawn(process.argv[0]!, process.argv.slice(1), {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', code => process.exit(code ?? 0));
}
