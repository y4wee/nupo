import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { NupoConfig, OdooServiceConfig, getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor, CliStartArgs } from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { ConfigureServiceScreen } from './ConfigureServiceScreen.js';
import { StartServiceScreen } from './StartServiceScreen.js';
import { TestServiceScreen } from './TestServiceScreen.js';
import { discoverServices } from '../services/odoo.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';

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
  const textColor   = getTextColor(config);
  const cursorColor = getCursorColor(config);

  const [phase,        setPhase]        = useState<Phase>('list');
  const [listSelected, setListSelected] = useState(0);
  const [search,       setSearch]       = useState('');
  const [actionCursor, setActionCursor] = useState(0);
  const [selectedSvc,  setSelectedSvc]  = useState<OdooServiceConfig | null>(null);
  const [activeScreen, setActiveScreen] = useState<ActiveScreen | null>(null);
  const [allServices,  setAllServices]  = useState<OdooServiceConfig[] | null>(null);
  const [reloadNonce,  setReloadNonce]  = useState(0);

  const reloadServices = useCallback(() => { setReloadNonce(n => n + 1); }, []);

  // Scan disk for .conf files whenever the config changes or a reload is requested
  useEffect(() => {
    let cancelled = false;
    void discoverServices(config).then(services => {
      if (!cancelled) setAllServices(services);
    });
    return () => { cancelled = true; };
  }, [config, reloadNonce]);

  const services = allServices ?? [];
  const filteredServices = search
    ? services.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    : services;
  const itemCount = 1 + filteredServices.length;

  // Auto-detection can surface far more .conf files than were ever manually
  // tracked. The outer App box is height-constrained with overflow="hidden" —
  // when actual content exceeds that, Ink/Yoga does not clip gracefully at the
  // bottom, it corrupts the whole frame (rows merge, stray characters remain).
  //
  // Measured live (tmux captures at heights 15-30): chrome above/below the
  // list + the 2 sticky rows ("+ Nouveau service" + separator) + 1 scroll
  // indicator costs ~20 rows; +1 more for the rare case both ▲ and ▼ show at
  // once; +2 more reserved for App.tsx's "update available" banner, which can
  // appear at any time and isn't visible to this component. There is
  // deliberately NO floor on the item count: forcing a minimum here (as a
  // previous version of this code did via Math.max(3, ...)) is what caused
  // the corruption — on a common 24-row terminal it left only ~1 row of
  // margin, so the budget must be free to show fewer items (even zero) on a
  // small terminal rather than overflow. Every list row is also forced to a
  // single line (wrap="truncate-end") so a long name can never silently
  // consume 2 rows.
  const { rows: termRows } = useTerminalSize();
  const FIXED_OVERHEAD = 20 + 1 + 2;
  const maxVisibleServices = Math.max(0, termRows - FIXED_OVERHEAD);
  const windowStartRef = useRef(0);
  {
    const selIdx = listSelected - 1; // -1 === "+ Nouveau service" itself
    if (selIdx < 0) {
      windowStartRef.current = 0;
    } else if (selIdx < windowStartRef.current) {
      windowStartRef.current = selIdx;
    } else if (selIdx >= windowStartRef.current + maxVisibleServices) {
      windowStartRef.current = selIdx - maxVisibleServices + 1;
    }
    const maxWindowStart = Math.max(0, filteredServices.length - maxVisibleServices);
    windowStartRef.current = Math.min(windowStartRef.current, maxWindowStart);
  }
  const windowStart = windowStartRef.current;
  const visibleServices = filteredServices.slice(windowStart, windowStart + maxVisibleServices);
  const hiddenAbove = windowStart;
  const hiddenBelow = Math.max(0, filteredServices.length - windowStart - visibleServices.length);

  // Auto-navigate to start screen for CLI --start flag (fires once the first
  // scan resolves, never again on later reloads)
  const autoStartHandled = useRef(false);
  useEffect(() => {
    if (!autoStart || !allServices || autoStartHandled.current) return;
    autoStartHandled.current = true;
    const svc = allServices.find(s => s.name === autoStart.serviceName);
    if (svc) setActiveScreen({ type: 'start', service: svc });
  }, [autoStart, allServices]);

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
        onComplete={() => {
          // Only reached via "created" (create mode) or "deleted" (delete) —
          // a plain param edit stays on the edit_list step and never fires this.
          onConfigChange();
          reloadServices();
          setActiveScreen(null);
          setPhase('list');
        }}
        onBack={() => { setActiveScreen(null); setPhase(isNew ? 'list' : 'actions'); }}
        onParamSaved={(updatedSvc) => {
          onConfigChange();
          reloadServices();
          setSelectedSvc(updatedSvc);
        }}
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

  // Render nothing until the first disk scan resolves, rather than an
  // intermediate "loading" frame: Ink's diff between two very differently
  // shaped frames (loading vs. populated list) can corrupt the terminal
  // output. A single clean transition (menu → populated list) avoids that.
  if (allServices === null) {
    return null;
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
              wrap="truncate-end"
            >
              {` ${listSelected === 0 ? '▶' : ' '} + Nouveau service`}
            </Text>

            {filteredServices.length > 0 && (
              <Text color={textColor} dimColor wrap="truncate-end">{'  ─────────────────'}</Text>
            )}

            {services.length === 0 && (
              <Text color={textColor} dimColor wrap="truncate-end">{'  Aucun service détecté (aucun .conf dans config/)'}</Text>
            )}

            {services.length > 0 && filteredServices.length === 0 && (
              <Text color={textColor} dimColor wrap="truncate-end">{`  Aucun service correspondant à "${search}"`}</Text>
            )}

            {hiddenAbove > 0 && (
              <Text color={textColor} dimColor wrap="truncate-end">{`  ▲ ${hiddenAbove} de plus`}</Text>
            )}

            {visibleServices.map((s, i) => {
              const absoluteIdx = windowStart + i;
              const isSel = absoluteIdx + 1 === listSelected;
              return (
                <Text
                  key={s.confPath}
                  color={isSel ? 'black' : 'white'}
                  backgroundColor={isSel ? cursorColor : undefined}
                  bold={isSel}
                  wrap="truncate-end"
                >
                  {` ${isSel ? '▶' : ' '} ${s.name}  `}
                  <Text color={isSel ? 'black' : 'gray'} dimColor={!isSel}>
                    {s.branch}{s.useEnterprise ? '  · Enterprise' : ''}
                    {s.customAddonsPaths.length > 0 ? `  · ${s.customAddonsPaths.length} dossier(s) custom` : ''}
                  </Text>
                </Text>
              );
            })}

            {hiddenBelow > 0 && (
              <Text color={textColor} dimColor wrap="truncate-end">{`  ▼ ${hiddenBelow} de plus`}</Text>
            )}
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
