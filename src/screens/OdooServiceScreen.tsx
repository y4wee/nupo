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
  const allServices  = Object.values(config.odoo_services ?? {})
    .sort((a, b) => a.name.localeCompare(b.name));
  const textColor   = getTextColor(config);
  const cursorColor = getCursorColor(config);

  const [phase,        setPhase]        = useState<Phase>('list');
  const [listSelected, setListSelected] = useState(0);
  const [search,       setSearch]       = useState('');
  const [actionCursor, setActionCursor] = useState(0);
  const [selectedSvc,  setSelectedSvc]  = useState<OdooServiceConfig | null>(null);
  const [activeScreen, setActiveScreen] = useState<ActiveScreen | null>(null);

  const filteredServices = search
    ? allServices.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    : allServices;
  const itemCount = 1 + filteredServices.length;

  // Auto-navigate to start screen for CLI --start flag
  useEffect(() => {
    if (!autoStart) return;
    const svc = allServices.find(s => s.name === autoStart.serviceName);
    if (svc) setActiveScreen({ type: 'start', service: svc });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── List phase input ──────────────────────────────────────────────────────

  useInput((char, key) => {
    if (key.escape) {
      if (search) { setSearch(''); setListSelected(0); return; }
      onBack();
      return;
    }
    if (key.upArrow)   { setListSelected(p => (p - 1 + itemCount) % itemCount); return; }
    if (key.downArrow) { setListSelected(p => (p + 1) % itemCount); return; }
    if (key.return) {
      if (listSelected === 0) {
        setActiveScreen({ type: 'configure', service: undefined });
      } else {
        const svc = filteredServices[listSelected - 1];
        if (svc) { setSelectedSvc(svc); setActionCursor(0); setPhase('actions'); }
      }
      return;
    }
    if (key.backspace || key.delete) {
      setSearch(p => p.slice(0, -1));
      setListSelected(0);
      return;
    }
    if (char && !key.ctrl && !key.meta && char.length === 1) {
      setSearch(p => p + char);
      setListSelected(0);
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
    const isNew = activeScreen.service === undefined;
    return (
      <ConfigureServiceScreen
        config={config}
        leftWidth={leftWidth}
        initialService={activeScreen.service}
        onComplete={() => { onConfigChange(); }}
        onBack={() => { setActiveScreen(null); setPhase(isNew ? 'list' : 'actions'); }}
        onParamSaved={(updatedSvc) => setSelectedSvc(updatedSvc)}
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

          {/* Search bar */}
          <Box borderStyle="round" borderColor={search ? 'cyan' : 'gray'} paddingX={1} flexDirection="row" gap={1}>
            <Text color="gray" dimColor>{'rechercher ›'}</Text>
            {search
              ? <Text color="white">{search}</Text>
              : <Text color="gray" dimColor>{'filtrer par nom…'}</Text>
            }
          </Box>

          <Box flexDirection="column" gap={0}>
            {/* Nouveau service */}
            <Text
              color={listSelected === 0 ? 'black' : 'cyan'}
              backgroundColor={listSelected === 0 ? cursorColor : undefined}
              bold={listSelected === 0}
            >
              {` ${listSelected === 0 ? '▶' : ' '} + Nouveau service`}
            </Text>

            {filteredServices.length > 0 && (
              <Text color={textColor} dimColor>{'  ─────────────────'}</Text>
            )}

            {allServices.length === 0 && (
              <Text color={textColor} dimColor>{'  Aucun service configuré'}</Text>
            )}

            {allServices.length > 0 && filteredServices.length === 0 && (
              <Text color={textColor} dimColor>{`  Aucun service correspondant à "${search}"`}</Text>
            )}

            {filteredServices.map((s, i) => {
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

          <Box>
            <Text color={textColor} dimColor>
              {'↑↓ naviguer  ·  ↵ sélectionner  ·  taper pour filtrer  ·  Échap'}
              {search ? ' effacer filtre' : ' retour'}
            </Text>
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
