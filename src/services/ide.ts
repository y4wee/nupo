import { mkdir, access, writeFile } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { OdooVersion } from '../types/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

export type IdeStepId = 'vscode_dir' | 'settings_json' | 'open_vscode';
export type IdeStepStatus = 'running' | 'success' | 'error';

export type IdeStepCallback = (
  id: IdeStepId,
  status: IdeStepStatus,
  detail?: string,
) => void;

// ── Main setup function ───────────────────────────────────────────────────────

/**
 * Sets up .vscode/ for the given Odoo version and opens VS Code.
 * Calls onStep for each step so callers can display progress (TUI or CLI).
 * Returns true on success, false on any error.
 */
export async function setupVsCode(
  version: OdooVersion,
  onStep: IdeStepCallback,
): Promise<boolean> {
  const vscodeDir    = join(version.path, '.vscode');
  const settingsPath = join(vscodeDir, 'settings.json');

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

  // ── Step 3: open VS Code ────────────────────────────────────────────────────
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
