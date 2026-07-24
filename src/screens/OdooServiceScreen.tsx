import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { NupoConfig, OdooServiceConfig, getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor, CliStartArgs } from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { ConfigureServiceScreen } from './ConfigureServiceScreen.js';
import { StartServiceScreen } from './StartServiceScreen.js';
import { TestServiceScreen } from './TestServiceScreen.js';

interface OdooServiceScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
  onConfigChange: () => void;
  onServiceRunning: (service: OdooServiceConfig) => void;
  onServiceStopped: () => void;
  autoStart?: CliStartArgs;
}

type Phase = 'list' | 'actions';

type ActiveScreen =
  | { type: 'configure'; service: OdooServiceConfig | undefined }
  | { type: 'start';     service: OdooServiceConfig }
  | { type: 'test';      service: OdooServiceConfig };

const ACTION_ITEMS = [
  { id: 'configure' as const, label: 'Configurer' },
  { id: 'start'     as const, label: 'Démarrer'   },
  { id: 'test'      as const, label: 'Tester'      },
];

export function OdooServiceScreen({
  config,
  leftWidth,
  onBack,
  onConfigChange,
  onServiceRunning,
  onServiceStopped,
  autoStart,
}: OdooServiceScreenProps) {
  const services    = Object.values(config.odoo_services ?? {});
  const textColor   = getTextColor(config);
  const cursorColor = getCursorColor(config);
  const itemCount   = 1 + services.length; // 0 = nouveau, 1..n = services

  const [phase,          setPhase]          = useState<Phase>('list');
  const [listSelected,   setListSelected]   = useState(0);
  const [actionCursor,   setActionCursor]   = useState(0);
  const [selectedSvc,    setSelectedSvc]    = useState<OdooServiceConfig | null>(null);
  const [activeScreen,   setActiveScreen]   = useState<ActiveScreen | null>(null);

  // Auto-navigate to start screen for CLI --start flag
  useEffect(() => {
    if (!autoStart) return;
    const svc = services.find(s => s.name === autoStart.serviceName);
    if (svc) setActiveScreen({ type: 'start', service: svc });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── List phase input ──────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { onBack(); return; }
    if (key.upArrow)   setListSelected(p => (p - 1 + itemCount) % itemCount);
    if (key.downArrow) setListSelected(p => (p + 1) % itemCount);
    if (key.return) {
      if (listSelected === 0) {
        setActiveScreen({ type: 'configure', service: undefined });
      } else {
        setSelectedSvc(services[listSelected - 1]!);
        setActionCursor(0);
        setPhase('actions');
      }
    }
  }, { isActive: phase === 'list' && activeScreen === null });

  // ── Actions phase input ───────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { setPhase('list'); return; }
    if (key.upArrow)   setActionCursor(p => Math.max(0, p - 1));
    if (key.downArrow) setActionCursor(p => Math.min(ACTION_ITEMS.length - 1, p + 1));
    if (key.return && selectedSvc) {
      const action = ACTION_ITEMS[actionCursor]!.id;
      if (action === 'configure') {
        setActiveScreen({ type: 'configure', service: selectedSvc });
      } else if (action === 'start') {
        setActiveScreen({ type: 'start', service: selectedSvc });
      } else {
        setActiveScreen({ type: 'test', service: selectedSvc });
      }
    }
  }, { isActive: phase === 'actions' && activeScreen === null });

  // ── Sub-screen routing ────────────────────────────────────────────────────

  if (activeScreen?.type === 'configure') {
    return (
      <ConfigureServiceScreen
        config={config}
        leftWidth={leftWidth}
        initialService={activeScreen.service}
        onComplete={() => { onConfigChange(); }}
        onBack={() => { setActiveScreen(null); setPhase('list'); }}
      />
    );
  }

  if (activeScreen?.type === 'start') {
    return (
      <StartServiceScreen
        config={config}
        leftWidth={leftWidth}
        initialService={activeScreen.service}
        onBack={() => { setActiveScreen(null); setPhase('actions'); }}
        onServiceRunning={onServiceRunning}
        onServiceStopped={onServiceStopped}
        autoStart={autoStart}
      />
    );
  }

  if (activeScreen?.type === 'test') {
    return (
      <TestServiceScreen
        config={config}
        leftWidth={leftWidth}
        service={activeScreen.service}
        onBack={() => { setActiveScreen(null); setPhase('actions'); }}
      />
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────

  if (phase === 'list') {
    return (
      <Box flexDirection="row" flexGrow={1}>
        <LeftPanel width={leftWidth} primaryColor={getPrimaryColor(config)} textColor={textColor} />

        <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
          <Text color={getSecondaryColor(config)} bold>Services</Text>

          <Box flexDirection="column" marginTop={1} gap={0}>
            <Text
              color={listSelected === 0 ? 'black' : 'cyan'}
              backgroundColor={listSelected === 0 ? cursorColor : undefined}
              bold={listSelected === 0}
            >
              {` ${listSelected === 0 ? '▶' : ' '} + Nouveau service`}
            </Text>

            {services.length > 0 && (
              <Text color={textColor} dimColor>{'  ─────────────────'}</Text>
            )}

            {services.length === 0 && (
              <Text color={textColor} dimColor>{'  Aucun service configuré'}</Text>
            )}

            {services.map((s, i) => {
              const isSel = i + 1 === listSelected;
              return (
                <Text
                  key={s.name}
                  color={isSel ? 'black' : 'white'}
                  backgroundColor={isSel ? cursorColor : undefined}
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
            <Text color={textColor} dimColor>{'↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour'}</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // ── Actions view ──────────────────────────────────────────────────────────

  return (
    <Box flexDirection="row" flexGrow={1}>
      <LeftPanel width={leftWidth} primaryColor={getPrimaryColor(config)} textColor={textColor} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={getSecondaryColor(config)} bold>Services · {selectedSvc?.name}</Text>

        <Box flexDirection="column" gap={0} marginTop={1}>
          {ACTION_ITEMS.map((item, i) => {
            const isSel = i === actionCursor;
            return (
              <Text
                key={item.id}
                color={isSel ? 'black' : 'white'}
                backgroundColor={isSel ? cursorColor : undefined}
                bold={isSel}
              >
                {` ${isSel ? '▶' : ' '} ${item.label}`}
              </Text>
            );
          })}
        </Box>

        <Box marginTop={1}>
          <Text color={textColor} dimColor>{'↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour'}</Text>
        </Box>
      </Box>
    </Box>
  );
}
