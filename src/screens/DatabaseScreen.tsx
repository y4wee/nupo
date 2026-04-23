import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { NupoConfig, getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor } from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { RestoreScreen } from './RestoreScreen.js';
import { DropScreen } from './DropScreen.js';
import { EditDatabaseScreen } from './EditDatabaseScreen.js';
import { MigrationScreen } from './MigrationScreen.js';

interface DatabaseScreenProps {
  leftWidth: number;
  config: NupoConfig;
  onBack: () => void;
}

const DB_OPTIONS = [
  {
    id: 'restore' as const,
    label: 'Restaurer une base',
    description: 'Restaurer une base de données depuis un fichier .zip présent dans dumps/.',
  },
  {
    id: 'drop' as const,
    label: 'Désinstaller une base',
    description: 'Supprimer une base de données psql et son dossier filestore correspondant.',
  },
  {
    id: 'edit' as const,
    label: 'Modification',
    description: 'Modifier les utilisateurs d\'une base : login, mot de passe, activation.',
  },
  {
    id: 'migration' as const,
    label: 'Migration',
    description: 'Migrer une base vers une version supérieure d\'Odoo via le service upgrade.odoo.com.',
  },
];

type DatabaseSubScreen = 'restore' | 'drop' | 'edit' | 'migration';

export function DatabaseScreen({ leftWidth, config, onBack }: DatabaseScreenProps) {
  const [subScreen, setSubScreen] = useState<DatabaseSubScreen | null>(null);
  const [selected, setSelected] = useState(0);
  const textColor = getTextColor(config);
  const cursorColor = getCursorColor(config);

  useInput(
    (_char, key) => {
      if (key.upArrow) setSelected(prev => (prev - 1 + DB_OPTIONS.length) % DB_OPTIONS.length);
      if (key.downArrow) setSelected(prev => (prev + 1) % DB_OPTIONS.length);
      if (key.return) setSubScreen(DB_OPTIONS[selected]!.id);
      if (key.escape) onBack();
    },
    { isActive: subScreen === null },
  );

  if (subScreen === 'restore') {
    return (
      <RestoreScreen
        config={config}
        leftWidth={leftWidth}
        onBack={() => setSubScreen(null)}
      />
    );
  }

  if (subScreen === 'drop') {
    return (
      <DropScreen
        config={config}
        leftWidth={leftWidth}
        onBack={() => setSubScreen(null)}
      />
    );
  }

  if (subScreen === 'edit') {
    return (
      <EditDatabaseScreen
        config={config}
        leftWidth={leftWidth}
        onBack={() => setSubScreen(null)}
      />
    );
  }

  if (subScreen === 'migration') {
    return (
      <MigrationScreen
        config={config}
        leftWidth={leftWidth}
        onBack={() => setSubScreen(null)}
      />
    );
  }

  const current = DB_OPTIONS[selected]!;

  return (
    <Box flexDirection="row">
      <LeftPanel width={leftWidth} primaryColor={getPrimaryColor(config)} textColor={textColor} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={getSecondaryColor(config)} bold>
          Base de Données
        </Text>

        <Box flexDirection="column" gap={0}>
          {DB_OPTIONS.map((opt, i) => {
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
