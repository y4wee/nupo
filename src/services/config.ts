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
