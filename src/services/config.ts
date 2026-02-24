import { homedir } from 'os';
import { join } from 'path';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { NupoConfig, DEFAULT_CONFIG } from '../types/index.js';

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

export async function writeConfig(config: NupoConfig): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true });
  await writeFile(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

export async function patchConfig(partial: Partial<NupoConfig>): Promise<void> {
  const current = await readConfig();
  await writeConfig({ ...current, ...partial });
}

export { getConfigPath, getConfigDir };
