import { mkdir, access, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { parse, modify, applyEdits, ParseError } from 'jsonc-parser';
import { OdooVersion } from '../types/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

export type IdeStepId = 'vscode_dir' | 'settings_json' | 'open_vscode';
export type IdeStepStatus = 'running' | 'success' | 'error';

export type IdeStepCallback = (
  id: IdeStepId,
  status: IdeStepStatus,
  detail?: string,
) => void;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
    const requiredSettings: Record<string, unknown> = {
      'python.defaultInterpreterPath': '${workspaceFolder}/.venv/bin/python',
      'python.terminal.activateEnvironment': true,
      'python.analysis.diagnosticMode': 'openFilesOnly',
      'files.exclude': {
        '**/__pycache__': true,
      },
      'search.exclude': {
        '**/__pycache__': true,
        '**/*.pyc': true,
        '**/*.log': true,
        'datas': true,
        'dumps': true,
      },
      'files.watcherExclude': {
        '**/__pycache__/**': true,
        '**/*.pyc': true,
        'venv/**': true,
        'datas/**': true,
        'dumps/**': true,
      },
    };

    let exists = false;
    try { await access(settingsPath); exists = true; } catch {}

    if (!exists) {
      await writeFile(settingsPath, JSON.stringify(requiredSettings, null, 4), 'utf-8');
      onStep('settings_json', 'success', 'créé');
    } else {
      const original = await readFile(settingsPath, 'utf-8');
      const parseErrors: ParseError[] = [];
      const current = parse(original, parseErrors, { allowTrailingComma: true });

      if (parseErrors.length > 0 || typeof current !== 'object' || current === null) {
        onStep('settings_json', 'success', 'existant, non modifiable');
      } else {
        let updated = original;
        let changed = false;
        for (const [key, value] of Object.entries(requiredSettings)) {
          const currentValue = (current as Record<string, unknown>)[key];
          if (!(key in current)) {
            const edits = modify(updated, [key], value, {});
            updated = applyEdits(updated, edits);
            changed = true;
          } else if (isPlainObject(value) && isPlainObject(currentValue)) {
            for (const [subKey, subValue] of Object.entries(value)) {
              if (!(subKey in currentValue)) {
                const edits = modify(updated, [key, subKey], subValue, {});
                updated = applyEdits(updated, edits);
                changed = true;
              }
            }
          }
        }

        if (changed) {
          await writeFile(settingsPath, updated, 'utf-8');
          onStep('settings_json', 'success', 'mis à jour');
        } else {
          onStep('settings_json', 'success', 'existant');
        }
      }
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
