import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { mkdir, access, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { NupoConfig, OdooVersion, OdooServiceConfig, getPrimaryColor, StepStatus } from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';

interface IdeScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
}

type IdeView = 'select' | 'setup';

type SetupStepId = 'vscode_dir' | 'settings_json' | 'launch_json' | 'open_vscode';

interface SetupStep {
  id: SetupStepId;
  label: string;
  status: StepStatus;
  detail?: string;
}

const INITIAL_STEPS: SetupStep[] = [
  { id: 'vscode_dir',    label: 'Dossier .vscode', status: 'pending' },
  { id: 'settings_json', label: 'settings.json',   status: 'pending' },
  { id: 'launch_json',   label: 'launch.json',     status: 'pending' },
  { id: 'open_vscode',   label: 'Ouvrir VS Code',  status: 'pending' },
];

const STATUS_ICONS: Record<StepStatus, string> = {
  pending: '○',
  running: '◌',
  success: '✓',
  error:   '✗',
};

const STATUS_COLORS: Record<StepStatus, string> = {
  pending: 'gray',
  running: 'cyan',
  success: 'green',
  error:   'red',
};

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
      // "GEVENT_SUPPORT": "True",
    },
  };
}

export function IdeScreen({ config, leftWidth, onBack }: IdeScreenProps) {
  const versions = Object.values(config.odoo_versions ?? {});
  const services = Object.values(config.odoo_services ?? {});

  const [view,     setView]     = useState<IdeView>('select');
  const [selected, setSelected] = useState(0);
  const [steps,    setSteps]    = useState<SetupStep[]>(INITIAL_STEPS);
  const [done,     setDone]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const primaryColor = getPrimaryColor(config);

  const patchStep = (id: SetupStepId, patch: Partial<SetupStep>) =>
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

  async function runSetup(version: OdooVersion) {
    setView('setup');
    setSteps(INITIAL_STEPS.map(s => ({ ...s })));
    setDone(false);
    setError(null);

    const vscodeDir    = join(version.path, '.vscode');
    const settingsPath = join(vscodeDir, 'settings.json');
    const launchPath   = join(vscodeDir, 'launch.json');

    // ── Step 1: .vscode directory ────────────────────────────────────────────
    patchStep('vscode_dir', { status: 'running' });
    try {
      await mkdir(vscodeDir, { recursive: true });
      patchStep('vscode_dir', { status: 'success' });
    } catch (e) {
      patchStep('vscode_dir', { status: 'error', detail: String(e) });
      setError(String(e));
      return;
    }

    // ── Step 2: settings.json ────────────────────────────────────────────────
    patchStep('settings_json', { status: 'running' });
    try {
      let exists = false;
      try { await access(settingsPath); exists = true; } catch {}
      if (!exists) {
        const content = {
          'python.defaultInterpreterPath': '${workspaceFolder}/.venv/bin/python',
          'python.terminal.activateEnvironment': true,
        };
        await writeFile(settingsPath, JSON.stringify(content, null, 4), 'utf-8');
        patchStep('settings_json', { status: 'success', detail: 'créé' });
      } else {
        patchStep('settings_json', { status: 'success', detail: 'existant' });
      }
    } catch (e) {
      patchStep('settings_json', { status: 'error', detail: String(e) });
      setError(String(e));
      return;
    }

    // ── Step 3: launch.json ──────────────────────────────────────────────────
    patchStep('launch_json', { status: 'running' });
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
      if (added)                          parts.push(`${added} config(s) ajoutée(s)`);
      if (!added && versionServices.length) parts.push('configs déjà présentes');
      if (!versionServices.length)        parts.push('aucun service pour cette version');
      patchStep('launch_json', { status: 'success', detail: parts.join(', ') });
    } catch (e) {
      patchStep('launch_json', { status: 'error', detail: String(e) });
      setError(String(e));
      return;
    }

    // ── Step 4: open VS Code ─────────────────────────────────────────────────
    patchStep('open_vscode', { status: 'running' });
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('code', [version.path], { detached: true, stdio: 'ignore' });
        proc.on('error', reject);
        setTimeout(() => { proc.unref(); resolve(); }, 200);
      });
      patchStep('open_vscode', { status: 'success' });
    } catch {
      patchStep('open_vscode', { status: 'error', detail: 'code introuvable — vérifiez le PATH' });
      setError('VS Code (code) introuvable dans le PATH');
      return;
    }

    setDone(true);
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { onBack(); return; }
    if (key.upArrow)   setSelected(p => Math.max(0, p - 1));
    if (key.downArrow) setSelected(p => Math.min(versions.length - 1, p + 1));
    if (key.return && versions[selected]) void runSetup(versions[selected]!);
  }, { isActive: view === 'select' });

  useInput((_char, key) => {
    if (key.escape || key.return) onBack();
  }, { isActive: view === 'setup' && (done || error !== null) });

  // ── Render: select ─────────────────────────────────────────────────────────

  if (view === 'select') {
    return (
      <Box flexDirection="row" flexGrow={1}>
        <LeftPanel width={leftWidth} primaryColor={primaryColor} />

        <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
          <Text color={primaryColor} bold>IDE</Text>

          {versions.length === 0 ? (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text color="yellow">Aucune version Odoo installée.</Text>
              <Text color="gray" dimColor>
                Installez une version via « Odoo → Installer une version ».
              </Text>
              <Box marginTop={1}>
                <Text color="gray" dimColor>Échap retour</Text>
              </Box>
            </Box>
          ) : (
            <Box flexDirection="column" gap={0} marginTop={1}>
              <Text color="gray" dimColor>
                Sélectionnez une version à ouvrir dans VS Code :
              </Text>
              <Box flexDirection="column" gap={0} marginTop={1}>
                {versions.map((v, i) => {
                  const isSel = i === selected;
                  return (
                    <Text
                      key={v.branch}
                      color={isSel ? 'black' : 'white'}
                      backgroundColor={isSel ? 'cyan' : undefined}
                      bold={isSel}
                    >
                      {` ${isSel ? '▶' : ' '} ${v.branch}  `}
                      <Text color={isSel ? 'black' : 'gray'} dimColor={!isSel}>
                        {v.path}
                      </Text>
                    </Text>
                  );
                })}
              </Box>
              <Box marginTop={1}>
                <Text color="gray" dimColor>↑↓ naviguer  ·  ↵ ouvrir  ·  Échap retour</Text>
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  // ── Render: setup ──────────────────────────────────────────────────────────

  return (
    <Box flexDirection="row" flexGrow={1}>
      <LeftPanel width={leftWidth} primaryColor={primaryColor} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={primaryColor} bold>IDE — Configuration VS Code</Text>

        <Box flexDirection="column" gap={0} marginTop={1}>
          {steps.map(s => (
            <Box key={s.id} flexDirection="row" gap={1}>
              <Text color={STATUS_COLORS[s.status]}>{STATUS_ICONS[s.status]}</Text>
              <Text color={s.status === 'error' ? 'red' : 'white'}>{s.label}</Text>
              {s.detail && <Text color="gray" dimColor>{s.detail}</Text>}
            </Box>
          ))}
        </Box>

        {error && (
          <Box marginTop={1} borderStyle="round" borderColor="red" paddingX={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}

        {(done || error) && (
          <Box marginTop={1}>
            <Text color="gray" dimColor>
              {done ? '↵/Échap retour' : 'Échap retour'}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
