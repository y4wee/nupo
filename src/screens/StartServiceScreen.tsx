import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { NupoConfig, OdooServiceConfig, getPrimaryColor, CliStartArgs } from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';

interface StartServiceScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
  onServiceRunning: (service: OdooServiceConfig) => void;
  onServiceStopped: () => void;
  autoStart?: CliStartArgs;
}

type Step = 'select' | 'args_list' | 'input_db' | 'input_module' | 'input_install' | 'running';

const ARGS_ITEMS = [
  { key: 'shell'           as const, label: 'shell',             type: 'toggle' as const },
  { key: 'db'              as const, label: '-d <database>',     type: 'input'  as const },
  { key: 'module'          as const, label: '-u <module>',       type: 'input'  as const },
  { key: 'install'         as const, label: '-i <module>',       type: 'input'  as const },
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
  opts: { shell: boolean; db: string; module: string; install: string; stopAfterInit: boolean },
): { cmd: string; args: string[] } {
  const python  = join(service.versionPath, 'venv', 'bin', 'python3');
  const odooBin = join(service.versionPath, 'community', 'odoo-bin');
  const args: string[] = [odooBin];

  if (opts.shell) args.push('shell');
  args.push('-c', service.confPath);
  args.push('--addons-path', buildAddonsPaths(service).join(','));
  if (opts.db)            args.push('-d', opts.db);
  if (opts.module)        args.push('-u', opts.module);
  if (opts.install)       args.push('-i', opts.install);
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
  autoStart,
}: StartServiceScreenProps) {
  const { rows } = useTerminalSize();
  const services = Object.values(config.odoo_services ?? {});

  const [step,       setStep]       = useState<Step>('select');
  const [selected,   setSelected]   = useState(0);
  const [argsCursor, setArgsCursor] = useState(0);

  const [useShell,      setUseShell]      = useState(false);
  const [dbName,        setDbName]        = useState('');
  const [moduleName,    setModuleName]    = useState('');
  const [installName,   setInstallName]   = useState('');
  const [stopAfterInit, setStopAfterInit] = useState(false);
  const [inputValue,    setInputValue]    = useState('');

  const [logs,         setLogs]         = useState<string[]>([]);
  const [exitCode,     setExitCode]     = useState<number | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [filterText,   setFilterText]   = useState('');
  const [filterMode,   setFilterMode]   = useState(false);
  const [autoStartError, setAutoStartError] = useState<string | null>(null);

  const childRef         = useRef<ChildProcess | null>(null);
  const mountedRef       = useRef(true);
  const activeServiceRef = useRef<OdooServiceConfig | null>(null);
  const userStoppedRef   = useRef(false);
  const maxScrollRef     = useRef(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      childRef.current?.kill('SIGTERM');
    };
  }, []);

  const service  = services[selected] as OdooServiceConfig | undefined;
  const warnNoDb = !!(moduleName || installName) && !dbName;

  // Fixed rows consumed outside the log box:
  // App borders(2) + Header(2) + running view padY(2) + gaps(4)
  // + header row(1) + urls box(4) + filter box(3) + controls(1) + log borders(2) = 21
  const logBoxHeight = Math.max(5, rows - 19); // outer height incl. borders
  const visibleLines = Math.max(3, logBoxHeight - 2); // inner content lines

  // ── Launch ────────────────────────────────────────────────────────────────

  const launchService = (
    svc?: OdooServiceConfig,
    overrideOpts?: { shell: boolean; db: string; module: string; install: string; stopAfterInit: boolean },
  ) => {
    const target = svc ?? service;
    if (!target) return;
    const opts = overrideOpts ?? { shell: useShell, db: dbName, module: moduleName, install: installName, stopAfterInit };

    activeServiceRef.current = target;
    setLogs([]);
    setExitCode(null);
    setScrollOffset(0);
    setStep('running');
    onServiceRunning(target);

    const { cmd, args } = buildLaunchCmd(target, opts);

    const proc = spawn(cmd, args);
    childRef.current = proc;

    const appendChunk = (chunk: Buffer) => {
      if (!mountedRef.current) return;
      const lines = chunk.toString().split('\n').filter(l => l.length > 0);
      setLogs(prev => [...prev, ...lines].slice(-(config.log_buffer_size ?? 500)));
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

  // ── Auto-start from CLI ────────────────────────────────────────────────────

  useEffect(() => {
    if (!autoStart) return;
    const svc = services.find(s => s.name === autoStart.serviceName);
    if (!svc) {
      setAutoStartError(`Service introuvable : "${autoStart.serviceName}"`);
      return;
    }
    launchService(svc, {
      shell:         autoStart.shell,
      db:            autoStart.db            ?? '',
      module:        autoStart.module        ?? '',
      install:       autoStart.install       ?? '',
      stopAfterInit: autoStart.stopAfterInit,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Input hooks ───────────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { onBack(); return; }
    if (autoStartError) return;
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
        case 'db':      setInputValue(dbName);      setStep('input_db');      break;
        case 'module':  setInputValue(moduleName);  setStep('input_module');  break;
        case 'install': setInputValue(installName); setStep('input_install'); break;
        case 'launch':  launchService(); break;
      }
    }
  }, { isActive: step === 'args_list' });

  useInput((_char, key) => {
    if (key.escape) setStep('args_list');
  }, { isActive: step === 'input_db' });

  useInput((_char, key) => {
    if (key.escape) setStep('args_list');
  }, { isActive: step === 'input_module' });

  useInput((_char, key) => {
    if (key.escape) setStep('args_list');
  }, { isActive: step === 'input_install' });

  useInput((char, key) => {
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
      return;
    }
    if (char === '/') {
      setFilterMode(true);
    }
  }, { isActive: step === 'running' && !filterMode });

  // Filter mode input — Escape exits filter mode
  useInput((_char, key) => {
    if (key.escape) {
      setFilterMode(false);
    }
  }, { isActive: step === 'running' && filterMode });

  // Mouse wheel scroll — active only while running and not in filter mode
  useEffect(() => {
    if (step !== 'running' || filterMode) return;

    // Enable mouse reporting (basic + SGR extended mode)
    process.stdout.write('\x1B[?1000h\x1B[?1006h');

    const handleData = (data: Buffer) => {
      const str = data.toString();
      // SGR format: ESC[<64;x;yM = scroll up, ESC[<65;x;yM = scroll down
      if (/\x1B\[<6[45];/.test(str)) {
        if (str.includes('\x1B[<64;')) setScrollOffset(p => Math.min(maxScrollRef.current, p + 1));
        if (str.includes('\x1B[<65;')) setScrollOffset(p => Math.max(0, p - 1));
        return;
      }
      // X10 fallback: ESC[M + 3 bytes, button byte 96=scroll up, 97=scroll down
      if (str.startsWith('\x1B[M') && str.length >= 6) {
        const btn = str.charCodeAt(3) - 32;
        if (btn === 64) setScrollOffset(p => Math.min(maxScrollRef.current, p + 1));
        if (btn === 65) setScrollOffset(p => Math.max(0, p - 1));
      }
    };

    process.stdin.on('data', handleData);
    return () => {
      process.stdout.write('\x1B[?1000l\x1B[?1006l');
      process.stdin.off('data', handleData);
    };
  }, [step, filterMode]);

  // Reset scroll when filter changes
  useEffect(() => { setScrollOffset(0); }, [filterText]);

  // ── Log window ────────────────────────────────────────────────────────────

  const filteredLogs = filterText
    ? logs.filter(l => l.toLowerCase().includes(filterText.toLowerCase()))
    : logs;
  const maxScroll       = Math.max(0, filteredLogs.length - visibleLines);
  maxScrollRef.current  = maxScroll;
  const offset          = Math.min(scrollOffset, maxScroll);
  const end         = filteredLogs.length - offset;
  const start       = Math.max(0, end - visibleLines);
  const visibleLogs = filteredLogs.slice(start, end);

  // ── Render helpers ────────────────────────────────────────────────────────

  const argIsSet: Record<string, boolean> = {
    shell:           useShell,
    db:              !!dbName,
    module:          !!moduleName,
    install:         !!installName,
    stop_after_init: stopAfterInit,
  };
  const argDisplay: Record<string, string> = { db: dbName, module: moduleName, install: installName };

  const activeService = activeServiceRef.current;

  // ── JSX ───────────────────────────────────────────────────────────────────

  if (step === 'running' && activeService) {
    return (
      <Box flexGrow={1} flexDirection="column" paddingX={2} paddingY={1} gap={1}>
        {/* URLs */}
        <Box borderStyle="round" borderColor="gray" paddingX={2} paddingY={0} flexDirection="column">
          <Text color="yellow">{`http://localhost:${httpPortForBranch(activeService.branch)}`}</Text>
          <Text color="yellow">{`http://localhost:${httpPortForBranch(activeService.branch)}/web/database/manager`}</Text>
        </Box>

        {/* Filter */}
        <Box borderStyle="round" borderColor={filterMode ? 'cyan' : 'gray'} paddingX={2} paddingY={0} flexDirection="row" gap={1}>
          <Text color="gray" dimColor>{'filtre ›'}</Text>
          {filterMode ? (
            <TextInput
              value={filterText}
              onChange={setFilterText}
              onSubmit={() => setFilterMode(false)}
              placeholder="rechercher dans les logs…"
            />
          ) : (
            <Text color={filterText ? 'white' : 'gray'} dimColor={!filterText}>
              {filterText || 'appuyer sur / pour filtrer'}
            </Text>
          )}
          {filterText !== '' && (
            <Text color="gray" dimColor>({filteredLogs.length})</Text>
          )}
        </Box>

        {/* Logs */}
        <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column" height={logBoxHeight} overflow="hidden">
          {visibleLogs.length === 0 ? (
            <Text color="gray" dimColor>En attente des logs…</Text>
          ) : (
            visibleLogs.map((line, i) => <LogLine key={start + i} line={line} idx={start + i} />)
          )}
        </Box>

        {/* Controls */}
        <Box>
          {filterMode ? (
            <Text color="gray" dimColor>taper pour filtrer  ·  ↵ valider  ·  Échap quitter filtre</Text>
          ) : exitCode === null ? (
            <Text color="gray" dimColor>scroll défiler  ·  / filtrer  ·  Ctrl+C arrêter</Text>
          ) : (
            <Text color="gray" dimColor>scroll défiler  ·  / filtrer  ·  Échap retour</Text>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" flexGrow={1}>
      <LeftPanel width={leftWidth} primaryColor={getPrimaryColor(config)} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={getPrimaryColor(config)} bold>Démarrer Service Odoo</Text>

        {/* ── auto-start error ── */}
        {autoStartError && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="red">{autoStartError}</Text>
            <Text color="gray" dimColor>
              Services disponibles :{' '}
              {services.length === 0
                ? 'aucun'
                : services.map(s => s.name).join(', ')}
            </Text>
            <Box marginTop={1}>
              <Text color="gray" dimColor>Échap retour</Text>
            </Box>
          </Box>
        )}

        {/* ── select ── */}
        {!autoStartError && step === 'select' && services.length === 0 && (
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

        {!autoStartError && step === 'select' && services.length > 0 && (
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
                        {display && <Text color={getPrimaryColor(config)}>{display}</Text>}
                      </>
                    )}
                  </Box>
                );
              })}
            </Box>
            {warnNoDb && (
              <Box marginTop={1}>
                <Text color="yellow">⚠  -u/-i nécessite un -d (base de données non définie)</Text>
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

        {/* ── input_install ── */}
        {step === 'input_install' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="white">Module à installer (-i) :</Text>
            <Box>
              <Text color="gray" dimColor>{'› '}</Text>
              <TextInput
                value={inputValue}
                onChange={setInputValue}
                onSubmit={v => { setInstallName(v.trim()); setStep('args_list'); }}
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
