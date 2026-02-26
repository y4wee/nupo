import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { NupoConfig, OdooServiceConfig, getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor, CliStartArgs } from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { InstallVersionScreen } from './InstallVersionScreen.js';
import { UpgradeVersionScreen } from './UpgradeVersionScreen.js';
import { OdooServiceScreen } from './OdooServiceScreen.js';
import { StartServiceScreen } from './StartServiceScreen.js';

interface OdooScreenProps {
  leftWidth: number;
  config: NupoConfig;
  onBack: () => void;
  onConfigChange: () => void;
  onServiceRunning: (service: OdooServiceConfig) => void;
  onServiceStopped: () => void;
  autoStart?: CliStartArgs;
}

const ODOO_OPTIONS = [
  {
    id: 'install' as const,
    label: 'Installer une version',
    description: "Installer une nouvelle version d'Odoo : télécharge community et enterprise avec --depth 1.",
  },
  {
    id: 'upgrade' as const,
    label: 'Mise à niveau',
    description: "Mettre à jour une version Odoo installée : récupère les derniers commits de community et enterprise.",
  },
  {
    id: 'service' as const,
    label: 'Configurer Service Odoo',
    description: "Créer ou modifier un fichier de configuration .conf pour démarrer un service Odoo.",
  },
  {
    id: 'start' as const,
    label: 'Démarrer Service Odoo',
    description: "Lancer un service Odoo configuré avec des arguments supplémentaires optionnels.",
  },
];

type OdooSubScreen = 'install' | 'upgrade' | 'service' | 'start';

export function OdooScreen({ leftWidth, config, onBack, onConfigChange, onServiceRunning, onServiceStopped, autoStart }: OdooScreenProps) {
  const [subScreen, setSubScreen] = useState<OdooSubScreen | null>(null);
  const [selected, setSelected] = useState(0);
  const textColor = getTextColor(config);
  const cursorColor = getCursorColor(config);

  // Auto-navigate to start screen when CLI args are present
  useEffect(() => {
    if (autoStart) setSubScreen('start');
  }, []);

  useInput(
    (_char, key) => {
      if (key.upArrow) setSelected(prev => (prev - 1 + ODOO_OPTIONS.length) % ODOO_OPTIONS.length);
      if (key.downArrow) setSelected(prev => (prev + 1) % ODOO_OPTIONS.length);
      if (key.return) setSubScreen(ODOO_OPTIONS[selected]!.id);
      if (key.escape) onBack();
    },
    { isActive: subScreen === null },
  );

  if (subScreen === 'install') {
    return (
      <InstallVersionScreen
        config={config}
        leftWidth={leftWidth}
        onComplete={() => { onConfigChange(); setSubScreen(null); }}
        onBack={() => setSubScreen(null)}
      />
    );
  }

  if (subScreen === 'upgrade') {
    return (
      <UpgradeVersionScreen
        config={config}
        leftWidth={leftWidth}
        onBack={() => setSubScreen(null)}
      />
    );
  }

  if (subScreen === 'service') {
    return (
      <OdooServiceScreen
        config={config}
        leftWidth={leftWidth}
        onBack={() => setSubScreen(null)}
        onConfigChange={() => { onConfigChange(); setSubScreen(null); }}
      />
    );
  }

  if (subScreen === 'start') {
    return (
      <StartServiceScreen
        config={config}
        leftWidth={leftWidth}
        onBack={() => setSubScreen(null)}
        onServiceRunning={onServiceRunning}
        onServiceStopped={onServiceStopped}
        autoStart={autoStart}
      />
    );
  }

  const current = ODOO_OPTIONS[selected]!;

  return (
    <Box flexDirection="row">
      <LeftPanel width={leftWidth} primaryColor={getPrimaryColor(config)} textColor={textColor} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={getSecondaryColor(config)} bold>
          Odoo
        </Text>

        <Box flexDirection="column" gap={0}>
          {ODOO_OPTIONS.map((opt, i) => {
            const isSelected = i === selected;
            return (
              <Text
                key={opt.id}
                color={isSelected ? 'black' : 'white'}
                backgroundColor={isSelected ? cursorColor : undefined}
                bold={isSelected}
              >
                {` ${isSelected ? '▶' : ' '} ${opt.label}`}
              </Text>
            );
          })}
        </Box>

        <Box borderStyle="round" borderColor={textColor} paddingX={1} paddingY={0}>
          <Text color={textColor} wrap="wrap">
            {current.description}
          </Text>
        </Box>

        <Box>
          <Text color={textColor} dimColor>
            {'↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour'}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
