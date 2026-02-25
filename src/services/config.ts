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

// ── Base Odoo conf ────────────────────────────────────────────────────────────

export function getBaseConfPath(): string {
  return join(getConfigDir(), 'odoo_base.conf');
}

const DEFAULT_BASE_CONF = `[options]
csv_internal_sep = ,
data_dir = /home/${process.env['USER'] ?? 'odoo'}/.local/share/Odoo
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
geoip_database = /usr/share/GeoIP/GeoLite2-City.mmdb
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
admin_passwd = admin
`;

export async function ensureBaseConf(): Promise<void> {
  const path = getBaseConfPath();
  try {
    await access(path);
  } catch {
    await mkdir(getConfigDir(), { recursive: true });
    await writeFile(path, DEFAULT_BASE_CONF, 'utf-8');
  }
}

export async function readBaseConf(): Promise<string> {
  await ensureBaseConf();
  return readFile(getBaseConfPath(), 'utf-8');
}
