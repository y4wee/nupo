import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { NupoConfig, OdooServiceConfig } from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { ConfigureServiceScreen } from './ConfigureServiceScreen.js';

interface OdooServiceScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
  onConfigChange: () => void;
}

type SubScreen = 'new' | OdooServiceConfig;

export function OdooServiceScreen({ config, leftWidth, onBack, onConfigChange }: OdooServiceScreenProps) {
  const services = Object.values(config.odoo_services ?? {});
  const itemCount = 1 + services.length; // 0 = nouveau, 1..n = services
  const [selected, setSelected] = useState(0);
  const [subScreen, setSubScreen] = useState<SubScreen | null>(null);

  useInput(
    (_char, key) => {
      if (key.escape) { onBack(); return; }
      if (key.upArrow)   setSelected(p => (p - 1 + itemCount) % itemCount);
      if (key.downArrow) setSelected(p => (p + 1) % itemCount);
      if (key.return) {
        if (selected === 0) setSubScreen('new');
        else setSubScreen(services[selected - 1]!);
      }
    },
    { isActive: subScreen === null },
  );

  if (subScreen !== null) {
    return (
      <ConfigureServiceScreen
        config={config}
        leftWidth={leftWidth}
        initialService={subScreen === 'new' ? undefined : subScreen}
        onComplete={() => { onConfigChange(); setSubScreen(null); }}
        onBack={() => setSubScreen(null)}
      />
    );
  }

  return (
    <Box flexDirection="row" flexGrow={1}>
      <LeftPanel width={leftWidth} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color="cyan" bold>Configurer Service Odoo</Text>

        <Box flexDirection="column" marginTop={1} gap={0}>
          {/* Nouveau service */}
          <Text
            color={selected === 0 ? 'black' : 'cyan'}
            backgroundColor={selected === 0 ? 'cyan' : undefined}
            bold={selected === 0}
          >
            {` ${selected === 0 ? '▶' : ' '} + Nouveau service`}
          </Text>

          {/* Séparateur si des services existent */}
          {services.length > 0 && (
            <Text color="gray" dimColor>{'  ─────────────────'}</Text>
          )}

          {/* Services existants */}
          {services.length === 0 && (
            <Text color="gray" dimColor>{'  Aucun service configuré'}</Text>
          )}
          {services.map((s, i) => {
            const isSel = i + 1 === selected;
            return (
              <Text
                key={s.name}
                color={isSel ? 'black' : 'white'}
                backgroundColor={isSel ? 'cyan' : undefined}
                bold={isSel}
              >
                {` ${isSel ? '▶' : ' '} ${s.name}  `}
                <Text color={isSel ? 'black' : 'gray'} dimColor={!isSel}>
                  {s.branch}{s.useEnterprise ? '  · Enterprise' : ''}
                  {s.customFolders.length > 0 ? `  · ${s.customFolders.length} module(s)` : ''}
                </Text>
              </Text>
            );
          })}
        </Box>

        <Box marginTop={1}>
          <Text color="gray" dimColor>{'↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour'}</Text>
        </Box>
      </Box>
    </Box>
  );
}
