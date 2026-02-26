import { mkdir, access, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { OdooVersion, OdooServiceConfig } from '../types/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

export type IdeStepId = 'vscode_dir' | 'settings_json' | 'launch_json' | 'open_vscode';
export type IdeStepStatus = 'running' | 'success' | 'error';

export type IdeStepCallback = (
  id: IdeStepId,
  status: IdeStepStatus,
  detail?: string,
) => void;

function buildAddonsPaths(service: OdooServiceConfig): string[] {
  const paths = [join(service.versionPath, 'community', 'addons')];
  if (service.useEnterprise) paths.push(join(service.versionPath, 'enterprise'));
  for (const f of service.customFolders) paths.push(join(service.versionPath, 'custom', f));
  return paths;
}

function buildDebugConfig(service: OdooServiceConfig): Record<string, unknown> {
  return {
    name:        service.name,
    type:        'debugpy',
    request:     'launch',
    stopOnEntry: false,
    program:     join(service.versionPath, 'community', 'odoo-bin'),
    args: [
      '--addons-path',
      buildAddonsPaths(service).join(','),
      '-c',
      service.confPath,
    ],
    console:    'integratedTerminal',
    justMyCode: true,
    env: {
      PYTHONPATH: '${workspaceFolder}',
    },
  };
}

// ── Main setup function ───────────────────────────────────────────────────────

/**
 * Sets up .vscode/ for the given Odoo version and opens VS Code.
 * Calls onStep for each step so callers can display progress (TUI or CLI).
 * Returns true on success, false on any error.
 */
export async function setupVsCode(
  version: OdooVersion,
  services: OdooServiceConfig[],
  onStep: IdeStepCallback,
): Promise<boolean> {
  const vscodeDir    = join(version.path, '.vscode');
  const settingsPath = join(vscodeDir, 'settings.json');
  const launchPath   = join(vscodeDir, 'launch.json');

  // ── Step 1: .vscode directory ───────────────────────────────────────────────
  onStep('vscode_dir', 'running');
  try {
    await mkdir(vscodeDir, { recursive: true });
    onStep('vscode_dir', 'success');
  } catch (e) {
    onStep('vscode_dir', 'error', String(e));
    return false;
  }

  // ── Step 2: settings.json ───────────────────────────────────────────────────
  onStep('settings_json', 'running');
  try {
    let exists = false;
    try { await access(settingsPath); exists = true; } catch {}
    if (!exists) {
      const content = {
        'python.defaultInterpreterPath': '${workspaceFolder}/.venv/bin/python',
        'python.terminal.activateEnvironment': true,
      };
      await writeFile(settingsPath, JSON.stringify(content, null, 4), 'utf-8');
      onStep('settings_json', 'success', 'créé');
    } else {
      onStep('settings_json', 'success', 'existant');
    }
  } catch (e) {
    onStep('settings_json', 'error', String(e));
    return false;
  }

  // ── Step 3: launch.json ─────────────────────────────────────────────────────
  onStep('launch_json', 'running');
  try {
    type LaunchJson = { version: string; configurations: Record<string, unknown>[] };
    let launchData: LaunchJson = { version: '0.2.0', configurations: [] };

    try {
      const raw    = await readFile(launchPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<LaunchJson>;
      launchData.version        = parsed.version ?? '0.2.0';
      launchData.configurations = Array.isArray(parsed.configurations) ? parsed.configurations : [];
    } catch {}

    const versionServices = services.filter(s => s.versionPath === version.path);
    let added = 0;

    for (const svc of versionServices) {
      const alreadyExists = launchData.configurations.some(
        c => (c as { name?: string }).name === svc.name,
      );
      if (!alreadyExists) {
        launchData.configurations.push(buildDebugConfig(svc));
        added++;
      }
    }

    await writeFile(launchPath, JSON.stringify(launchData, null, 4), 'utf-8');

    const parts: string[] = [];
    if (added)                            parts.push(`${added} config(s) ajoutée(s)`);
    if (!added && versionServices.length) parts.push('configs déjà présentes');
    if (!versionServices.length)          parts.push('aucun service pour cette version');
    onStep('launch_json', 'success', parts.join(', '));
  } catch (e) {
    onStep('launch_json', 'error', String(e));
    return false;
  }

  // ── Step 4: open VS Code ────────────────────────────────────────────────────
  onStep('open_vscode', 'running');
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('code', [version.path], { detached: true, stdio: 'ignore' });
      proc.on('error', reject);
      setTimeout(() => { proc.unref(); resolve(); }, 200);
    });
    onStep('open_vscode', 'success');
  } catch {
    onStep('open_vscode', 'error', 'code introuvable — vérifiez le PATH');
    return false;
  }

  return true;
}
