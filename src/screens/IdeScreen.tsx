import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { NupoConfig, OdooVersion, getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor, StepStatus } from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { setupVsCode, IdeStepId } from '../services/ide.js';

interface IdeScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
}

type IdeView = 'select' | 'setup';

type SetupStepId = 'vscode_dir' | 'settings_json' | 'open_vscode';

interface SetupStep {
  id: SetupStepId;
  label: string;
  status: StepStatus;
  detail?: string;
}

const INITIAL_STEPS: SetupStep[] = [
  { id: 'vscode_dir',    label: 'Dossier .vscode', status: 'pending' },
  { id: 'settings_json', label: 'settings.json',   status: 'pending' },
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

export function IdeScreen({ config, leftWidth, onBack }: IdeScreenProps) {
  const versions = Object.values(config.odoo_versions ?? {});

  const [view,     setView]     = useState<IdeView>('select');
  const [selected, setSelected] = useState(0);
  const [steps,    setSteps]    = useState<SetupStep[]>(INITIAL_STEPS);
  const [done,     setDone]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const primaryColor = getPrimaryColor(config);
  const secondaryColor = getSecondaryColor(config);
  const textColor = getTextColor(config);
  const cursorColor = getCursorColor(config);

  const patchStep = (id: SetupStepId, patch: Partial<SetupStep>) =>
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

  async function runSetup(version: OdooVersion) {
    setView('setup');
    setSteps(INITIAL_STEPS.map(s => ({ ...s })));
    setDone(false);
    setError(null);

    const ok = await setupVsCode(version, (id, status, detail) => {
      patchStep(id as IdeStepId, { status: status as StepStatus, detail });
      if (status === 'error') setError(detail ?? 'Erreur inconnue');
    });

    if (ok) setDone(true);
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
        <LeftPanel width={leftWidth} primaryColor={primaryColor} textColor={textColor} />

        <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
          <Text color={secondaryColor} bold>IDE</Text>

          {versions.length === 0 ? (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text color="yellow">Aucune version Odoo installée.</Text>
              <Text color={textColor} dimColor>
                Installez une version via « Odoo → Installer une version ».
              </Text>
              <Box marginTop={1}>
                <Text color={textColor} dimColor>Échap retour</Text>
              </Box>
            </Box>
          ) : (
            <Box flexDirection="column" gap={0} marginTop={1}>
              <Text color={textColor} dimColor>
                Sélectionnez une version à ouvrir dans VS Code :
              </Text>
              <Box flexDirection="column" gap={0} marginTop={1}>
                {versions.map((v, i) => {
                  const isSel = i === selected;
                  return (
                    <Text
                      key={v.branch}
                      color={isSel ? 'black' : 'white'}
                      backgroundColor={isSel ? cursorColor : undefined}
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
                <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ ouvrir  ·  Échap retour</Text>
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
      <LeftPanel width={leftWidth} primaryColor={primaryColor} textColor={textColor} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={secondaryColor} bold>IDE — Configuration VS Code</Text>

        <Box flexDirection="column" gap={0} marginTop={1}>
          {steps.map(s => (
            <Box key={s.id} flexDirection="row" gap={1}>
              <Text color={STATUS_COLORS[s.status]}>{STATUS_ICONS[s.status]}</Text>
              <Text color={s.status === 'error' ? 'red' : 'white'}>{s.label}</Text>
              {s.detail && <Text color={textColor} dimColor>{s.detail}</Text>}
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
            <Text color={textColor} dimColor>
              {done ? '↵/Échap retour' : 'Échap retour'}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
