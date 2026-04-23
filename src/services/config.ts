import { homedir } from 'os';
import { join } from 'path';
import { readFile, writeFile, mkdir, access, rename } from 'fs/promises';
import { NupoConfig, DEFAULT_CONFIG } from '../types/index.js';

// Serialise all writes to prevent concurrent writeFile corruption
let writeQueue: Promise<void> = Promise.resolve();

function getConfigDir(): string {
  return join(process.env['NUPO_CONFIG_DIR'] ?? homedir(), '.nupo');
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export async function configExists(): Promise<boolean> {
  try {
    await access(getConfigPath());
    return true;
  } catch {
    return false;
  }
}

export async function readConfig(): Promise<NupoConfig> {
  try {
    const data = await readFile(getConfigPath(), 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: NupoConfig): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const dir = getConfigDir();
    const dest = getConfigPath();
    const tmp = dest + '.tmp';
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, JSON.stringify(config, null, 2), 'utf-8');
    await rename(tmp, dest);
  });
  return writeQueue;
}

export async function patchConfig(partial: Partial<NupoConfig>): Promise<void> {
  const current = await readConfig();
  await writeConfig({ ...current, ...partial });
}

export { getConfigPath, getConfigDir };

// ── Path migration ────────────────────────────────────────────────────────────

/**
 * Updates all paths derived from odoo_path_repo when the root path changes.
 * Patches config.json and rewrites .vscode/launch.json in each version dir.
 */
export async function migrateOdooPath(oldPath: string, newPath: string): Promise<void> {
  const current = await readConfig();
  const fix = (p: string) => p.startsWith(oldPath) ? newPath + p.slice(oldPath.length) : p;

  const odoo_versions = Object.fromEntries(
    Object.entries(current.odoo_versions).map(([b, v]) => [b, { ...v, path: fix(v.path) }]),
  );

  const odoo_services = current.odoo_services
    ? Object.fromEntries(
        Object.entries(current.odoo_services).map(([n, s]) => [
          n,
          { ...s, versionPath: fix(s.versionPath), confPath: fix(s.confPath) },
        ]),
      )
    : undefined;

  const pending_installs = current.pending_installs
    ? Object.fromEntries(
        Object.entries(current.pending_installs).map(([b, p]) => [b, { ...p, path: fix(p.path) }]),
      )
    : undefined;

  await writeConfig({
    ...current,
    odoo_path_repo: newPath,
    odoo_versions,
    ...(odoo_services   ? { odoo_services }   : {}),
    ...(pending_installs ? { pending_installs } : {}),
  });

  // Rewrite .vscode/launch.json in each version directory
  for (const version of Object.values(odoo_versions)) {
    const launchPath = join(version.path, '.vscode', 'launch.json');
    try {
      const content = await readFile(launchPath, 'utf-8');
      const updated = content.split(oldPath).join(newPath);
      if (updated !== content) await writeFile(launchPath, updated, 'utf-8');
    } catch { /* no launch.json, nothing to update */ }
  }
}

// ── Base Odoo conf ────────────────────────────────────────────────────────────

export function getBaseConfPath(): string {
  return join(getConfigDir(), 'odoo_base.conf');
}

function getOdooDataDir(versionPath?: string): string {
  if (versionPath) return versionPath;
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Odoo');
  }
  return join(homedir(), '.local', 'share', 'Odoo');
}

function getGeoIpPath(): string {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64'
      ? '/opt/homebrew/share/GeoIP/GeoLite2-City.mmdb'
      : '/usr/local/share/GeoIP/GeoLite2-City.mmdb';
  }
  return '/usr/share/GeoIP/GeoLite2-City.mmdb';
}

function buildDefaultBaseConf(versionPath?: string): string {
  return `[options]
csv_internal_sep = ,
data_dir = ${getOdooDataDir(versionPath)}
db_host = False
db_maxconn = 64
db_name = False
db_password = False
db_port = False
db_sslmode = prefer
db_template = template0
db_user = False
dbfilter =
demo = {}
email_from = False
from_filter = False
geoip_database = ${getGeoIpPath()}
gevent_port = 8077
http_enable = True
http_interface =
http_port = 8017
import_partial =
limit_memory_hard = 2684354560
limit_memory_soft = 2147483648
limit_request = 65536
limit_time_cpu = 6000
limit_time_real = 1200
limit_time_real_cron = -1
list_db = True
log_db = False
log_db_level = warning
log_handler = :INFO
log_level = info
logfile =
max_cron_threads = 2
osv_memory_age_limit = False
osv_memory_count_limit = 0
pg_path =
pidfile =
proxy_mode = False
reportgz = False
screencasts =
screenshots = /tmp/odoo_tests
server_wide_modules = base,web
smtp_password = False
smtp_port = 25
smtp_server = localhost
smtp_ssl = False
smtp_ssl_certificate_filename = False
smtp_ssl_private_key_filename = False
smtp_user = False
syslog = False
test_enable = False
test_file =
test_tags = None
transient_age_limit = 1.0
translate_modules = ['all']
unaccent = False
upgrade_path =
websocket_keep_alive_timeout = 3600
websocket_rate_limit_burst = 10
websocket_rate_limit_delay = 0.2
without_demo = False
workers = 0
x_sendfile = False
admin_passwd = $pbkdf2-sha512$25000$z9kbI8TYe88Z4xyDUEopBQ$xp2JCsrnL/E2JJMpkz//mEjHdyBoy7nOrXujIr0Mlsn2XNp8GXmY0KxGKWpOmxeAMczduLQKaaQU4gJbNFl8Wg
`;
}

export async function ensureBaseConf(versionPath?: string): Promise<void> {
  const path = getBaseConfPath();
  try {
    await access(path);
  } catch {
    await mkdir(getConfigDir(), { recursive: true });
    await writeFile(path, buildDefaultBaseConf(versionPath), 'utf-8');
  }
}

export async function readBaseConf(versionPath?: string): Promise<string> {
  await ensureBaseConf(versionPath);
  return readFile(getBaseConfPath(), 'utf-8');
}
