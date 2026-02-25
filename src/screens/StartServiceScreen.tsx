import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { NupoConfig, OdooServiceConfig } from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';

interface StartServiceScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
  onServiceRunning: () => void;
  onServiceStopped: () => void;
}

type Step = 'select' | 'args_list' | 'input_db' | 'input_module' | 'running';

const ARGS_ITEMS = [
  { key: 'shell'           as const, label: 'shell',             type: 'toggle' as const },
  { key: 'db'              as const, label: '-d <database>',     type: 'input'  as const },
  { key: 'module'          as const, label: '-u <module>',       type: 'input'  as const },
  { key: 'stop_after_init' as const, label: '--stop-after-init', type: 'toggle' as const },
  { key: 'launch'          as const, label: 'Lancer →',          type: 'action' as const },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function httpPortForBranch(branch: string): number {
  const m = branch.match(/(\d+)\./);
  return m ? 8000 + parseInt(m[1]!, 10) : 8069;
}

function buildAddonsPaths(service: OdooServiceConfig): string[] {
  const paths = [join(service.versionPath, 'community', 'addons')];
  if (service.useEnterprise) paths.push(join(service.versionPath, 'enterprise'));
  for (const f of service.customFolders) paths.push(join(service.versionPath, 'custom', f));
  return paths;
}

function buildLaunchCmd(
  service: OdooServiceConfig,
  opts: { shell: boolean; db: string; module: string; stopAfterInit: boolean },
): { cmd: string; args: string[] } {
  const python  = join(service.versionPath, 'venv', 'bin', 'python3');
  const odooBin = join(service.versionPath, 'community', 'odoo-bin');
  const args: string[] = [odooBin];

  if (opts.shell) args.push('shell');
  args.push('-c', service.confPath);
  args.push('--addons-path', buildAddonsPaths(service).join(','));
  if (opts.db)            args.push('-d', opts.db);
  if (opts.module)        args.push('-u', opts.module);
  if (opts.stopAfterInit) args.push('--stop-after-init');

  return { cmd: python, args };
}

const LEVEL_COLORS: Record<string, string> = {
  INFO:     'green',
  WARNING:  'yellow',
  ERROR:    'red',
  CRITICAL: 'red',
  DEBUG:    'gray',
};

function LogLine({ line, idx }: { line: string; idx: number }): React.ReactElement {
  const match = line.match(/\b(INFO|WARNING|ERROR|CRITICAL|DEBUG)\b/);
  if (!match || match.index === undefined) {
    return <Text key={idx} color="white" wrap="wrap">{line}</Text>;
  }
  const level  = match[0]!;
  const before = line.slice(0, match.index);
  const after  = line.slice(match.index + level.length);
  return (
    <Text key={idx} color="white" wrap="wrap">
      {before}<Text color={LEVEL_COLORS[level]}>{level}</Text>{after}
    </Text>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function StartServiceScreen({
  config,
  leftWidth,
  onBack,
  onServiceRunning,
  onServiceStopped,
}: StartServiceScreenProps) {
  const { rows } = useTerminalSize();
  const services = Object.values(config.odoo_services ?? {});

  const [step,       setStep]       = useState<Step>('select');
  const [selected,   setSelected]   = useState(0);
  const [argsCursor, setArgsCursor] = useState(0);

  const [useShell,      setUseShell]      = useState(false);
  const [dbName,        setDbName]        = useState('');
  const [moduleName,    setModuleName]    = useState('');
  const [stopAfterInit, setStopAfterInit] = useState(false);
  const [inputValue,    setInputValue]    = useState('');

  const [logs,         setLogs]         = useState<string[]>([]);
  const [exitCode,     setExitCode]     = useState<number | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);

  const childRef         = useRef<ChildProcess | null>(null);
  const mountedRef       = useRef(true);
  const activeServiceRef = useRef<OdooServiceConfig | null>(null);
  const userStoppedRef   = useRef(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      childRef.current?.kill('SIGTERM');
    };
  }, []);

  const service  = services[selected] as OdooServiceConfig | undefined;
  const warnNoDb = !!moduleName && !dbName;

  const visibleLines = Math.max(5, rows - 12);

  // ── Launch ────────────────────────────────────────────────────────────────

  const launchService = () => {
    if (!service) return;
    activeServiceRef.current = service;
    setLogs([]);
    setExitCode(null);
    setScrollOffset(0);
    setStep('running');
    onServiceRunning();

    const { cmd, args } = buildLaunchCmd(service, {
      shell: useShell, db: dbName, module: moduleName, stopAfterInit,
    });

    const proc = spawn(cmd, args);
    childRef.current = proc;

    const appendChunk = (chunk: Buffer) => {
      if (!mountedRef.current) return;
      const lines = chunk.toString().split('\n').filter(l => l.length > 0);
      setLogs(prev => [...prev, ...lines].slice(-500));
    };

    proc.stdout?.on('data', appendChunk);
    proc.stderr?.on('data', appendChunk);
    proc.on('close', code => {
      childRef.current = null;
      if (!mountedRef.current) return;
      if (userStoppedRef.current) {
        userStoppedRef.current = false;
        setLogs([]);
        setExitCode(null);
        setScrollOffset(0);
        setStep('args_list');
      } else {
        setExitCode(code ?? -1);
      }
      onServiceStopped();
    });
  };

  // ── Input hooks ───────────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { onBack(); return; }
    if (services.length === 0) return;
    if (key.upArrow)   setSelected(p => Math.max(0, p - 1));
    if (key.downArrow) setSelected(p => Math.min(services.length - 1, p + 1));
    if (key.return && service) setStep('args_list');
  }, { isActive: step === 'select' });

  useInput((char, key) => {
    if (key.escape) { setStep('select'); return; }
    if (key.upArrow)   setArgsCursor(p => Math.max(0, p - 1));
    if (key.downArrow) setArgsCursor(p => Math.min(ARGS_ITEMS.length - 1, p + 1));
    if (key.return || char === ' ') {
      const item = ARGS_ITEMS[argsCursor]!;
      switch (item.key) {
        case 'shell':           setUseShell(p => !p); break;
        case 'stop_after_init': setStopAfterInit(p => !p); break;
        case 'db':     setInputValue(dbName);     setStep('input_db');     break;
        case 'module': setInputValue(moduleName); setStep('input_module'); break;
        case 'launch': launchService(); break;
      }
    }
  }, { isActive: step === 'args_list' });

  useInput((_char, key) => {
    if (key.escape) setStep('args_list');
  }, { isActive: step === 'input_db' });

  useInput((_char, key) => {
    if (key.escape) setStep('args_list');
  }, { isActive: step === 'input_module' });

  useInput((char, key) => {
    if (key.upArrow)   setScrollOffset(p => p + 1);
    if (key.downArrow) setScrollOffset(p => Math.max(0, p - 1));

    if (exitCode !== null) {
      if (key.escape) {
        setStep('args_list');
        setLogs([]);
        setExitCode(null);
        setScrollOffset(0);
      }
      return;
    }

    if (key.ctrl && char === 'c') {
      userStoppedRef.current = true;
      childRef.current?.kill('SIGTERM');
    }
  }, { isActive: step === 'running' });

  // ── Log window ────────────────────────────────────────────────────────────

  const maxScroll   = Math.max(0, logs.length - visibleLines);
  const offset      = Math.min(scrollOffset, maxScroll);
  const end         = logs.length - offset;
  const start       = Math.max(0, end - visibleLines);
  const visibleLogs = logs.slice(start, end);

  // ── Render helpers ────────────────────────────────────────────────────────

  const argIsSet: Record<string, boolean> = {
    shell:           useShell,
    db:              !!dbName,
    module:          !!moduleName,
    stop_after_init: stopAfterInit,
  };
  const argDisplay: Record<string, string> = { db: dbName, module: moduleName };

  const activeService = activeServiceRef.current;

  // ── JSX ───────────────────────────────────────────────────────────────────

  if (step === 'running' && activeService) {
    return (
      <Box flexGrow={1} flexDirection="column" paddingX={2} paddingY={1} gap={1}>
        {/* Header */}
        <Box flexDirection="row" gap={2}>
          <Text color="cyan" bold>Démarrer Service Odoo</Text>
          <Text color="yellow" bold>{activeService.name}</Text>
          {exitCode === null ? (
            <Text color="green">● en cours</Text>
          ) : (
            <Text color={exitCode === 0 ? 'green' : 'red'}>■ arrêté (code {exitCode})</Text>
          )}
          {scrollOffset > 0 && <Text color="gray" dimColor>↑ +{scrollOffset} lignes</Text>}
        </Box>

        {/* URLs */}
        <Box borderStyle="round" borderColor="gray" paddingX={2} paddingY={0} flexDirection="column">
          <Text color="yellow">{`http://localhost:${httpPortForBranch(activeService.branch)}`}</Text>
          <Text color="yellow">{`http://localhost:${httpPortForBranch(activeService.branch)}/web/database/manager`}</Text>
        </Box>

        {/* Logs */}
        <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column" height={visibleLines + 2} overflow="hidden">
          {visibleLogs.length === 0 ? (
            <Text color="gray" dimColor>En attente des logs…</Text>
          ) : (
            visibleLogs.map((line, i) => <LogLine key={start + i} line={line} idx={start + i} />)
          )}
        </Box>

        {/* Controls */}
        <Box>
          {exitCode === null ? (
            <Text color="gray" dimColor>↑↓ défiler  ·  Ctrl+C arrêter le service</Text>
          ) : (
            <Text color="gray" dimColor>↑↓ défiler  ·  Échap retour</Text>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" flexGrow={1}>
      <LeftPanel width={leftWidth} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color="cyan" bold>Démarrer Service Odoo</Text>

        {/* ── select ── */}
        {step === 'select' && services.length === 0 && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="yellow">Aucun service configuré.</Text>
            <Text color="gray" dimColor>
              Créez d'abord un service via « Configurer Service Odoo ».
            </Text>
            <Box marginTop={1}>
              <Text color="gray" dimColor>Échap retour</Text>
            </Box>
          </Box>
        )}

        {step === 'select' && services.length > 0 && (
          <Box flexDirection="column" gap={0} marginTop={1}>
            {services.map((svc, i) => {
              const isSel = i === selected;
              return (
                <Text
                  key={svc.name}
                  color={isSel ? 'black' : 'white'}
                  backgroundColor={isSel ? 'cyan' : undefined}
                  bold={isSel}
                >
                  {` ${isSel ? '▶' : ' '} ${svc.name}  `}
                  <Text color={isSel ? 'black' : 'gray'} dimColor={!isSel}>
                    {svc.branch}{svc.useEnterprise ? ' · Enterprise' : ''}
                  </Text>
                </Text>
              );
            })}
            <Box marginTop={1}>
              <Text color="gray" dimColor>↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour</Text>
            </Box>
          </Box>
        )}

        {/* ── args_list ── */}
        {step === 'args_list' && (
          <Box flexDirection="column" gap={0} marginTop={1}>
            <Text color="white">Arguments supplémentaires :</Text>
            <Box flexDirection="column" gap={0} marginTop={1}>
              {ARGS_ITEMS.map((item, i) => {
                const isSel    = i === argsCursor;
                const isAction = item.type === 'action';
                const isSet    = argIsSet[item.key] ?? false;
                const display  = argDisplay[item.key] ?? '';
                return (
                  <Box key={item.key} flexDirection="row" gap={1}>
                    {isAction ? (
                      <Text
                        color={isSel ? 'black' : 'green'}
                        backgroundColor={isSel ? 'green' : undefined}
                        bold
                      >
                        {` ${isSel ? '▶' : ' '} ${item.label}`}
                      </Text>
                    ) : (
                      <>
                        <Text
                          color={isSel ? 'black' : 'white'}
                          backgroundColor={isSel ? 'cyan' : undefined}
                          bold={isSel}
                        >
                          {` ${isSel ? '▶' : ' '} ${isSet ? '[✓]' : '[ ]'} ${item.label}`}
                        </Text>
                        {display && <Text color="cyan">{display}</Text>}
                      </>
                    )}
                  </Box>
                );
              })}
            </Box>
            {warnNoDb && (
              <Box marginTop={1}>
                <Text color="yellow">⚠  -u nécessite un -d (base de données non définie)</Text>
              </Box>
            )}
            <Box marginTop={1}>
              <Text color="gray" dimColor>↑↓ naviguer  ·  ↵/Espace basculer  ·  Échap retour</Text>
            </Box>
          </Box>
        )}

        {/* ── input_db ── */}
        {step === 'input_db' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="white">Base de données (-d) :</Text>
            <Box>
              <Text color="gray" dimColor>{'› '}</Text>
              <TextInput
                value={inputValue}
                onChange={setInputValue}
                onSubmit={v => { setDbName(v.trim()); setStep('args_list'); }}
                placeholder="ma_base"
              />
            </Box>
            <Text color="gray" dimColor>↵ valider  ·  Échap retour</Text>
          </Box>
        )}

        {/* ── input_module ── */}
        {step === 'input_module' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="white">Module à mettre à jour (-u) :</Text>
            <Box>
              <Text color="gray" dimColor>{'› '}</Text>
              <TextInput
                value={inputValue}
                onChange={setInputValue}
                onSubmit={v => { setModuleName(v.trim()); setStep('args_list'); }}
                placeholder="mon_module"
              />
            </Box>
            <Text color="gray" dimColor>↵ valider  ·  Échap retour</Text>
          </Box>
        )}

      </Box>
    </Box>
  );
}
