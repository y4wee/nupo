import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { spawn, ChildProcess } from 'child_process';
import { stat, readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { NupoConfig, OdooServiceConfig, getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor } from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { copyToClipboard } from '../services/system.js';
import { buildAddonsPaths } from '../services/odoo.js';

interface TestServiceScreenProps {
  config: NupoConfig;
  leftWidth: number;
  service: OdooServiceConfig;
  onBack: () => void;
}

type Phase = 'select_type' | 'input_db' | 'input_value' | 'checking' | 'running';
type TestType = 'module' | 'tags';

const TYPE_OPTIONS: { key: TestType; label: string; hint: string }[] = [
  { key: 'module', label: 'Module', hint: '--test-tags /nom_module' },
  { key: 'tags',   label: 'Tags',   hint: '--test-tags tag1,tag2'   },
];

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


async function getConfAddonsPaths(confPath: string): Promise<string[]> {
  try {
    const content = await readFile(confPath, 'utf8');
    const match = content.match(/^addons_path\s*=\s*(.+)$/m);
    if (!match) return [];
    return match[1]!.split(',').map(p => p.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function checkModuleExists(
  service: OdooServiceConfig,
  moduleName: string,
): Promise<{ found: boolean; paths: string[] }> {
  const builtPaths = buildAddonsPaths(service);
  const confPaths  = await getConfAddonsPaths(service.confPath);
  const paths      = [...new Set([...builtPaths, ...confPaths])];

  for (const p of paths) {
    try {
      const s = await stat(join(p, moduleName));
      if (s.isDirectory()) return { found: true, paths };
    } catch {}
    try {
      const entries = await readdir(p, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const s = await stat(join(p, entry.name, moduleName));
          if (s.isDirectory()) return { found: true, paths };
        } catch {}
      }
    } catch {}
  }
  return { found: false, paths };
}

export function TestServiceScreen({ config, leftWidth, service, onBack }: TestServiceScreenProps) {
  const { rows } = useTerminalSize();
  const textColor   = getTextColor(config);
  const cursorColor = getCursorColor(config);

  const [phase,       setPhase]       = useState<Phase>('select_type');
  const [typeCursor,  setTypeCursor]  = useState(0);
  const [testType,    setTestType]    = useState<TestType>('module');
  const [dbInput,     setDbInput]     = useState('');
  const [valueInput,  setValueInput]  = useState('');
  const [checkError,  setCheckError]  = useState<string | null>(null);
  const [checkedPaths, setCheckedPaths] = useState<string[]>([]);

  const [logs,         setLogs]         = useState<string[]>([]);
  const [exitCode,     setExitCode]     = useState<number | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [copyMode,     setCopyMode]     = useState(false);
  const [copyInput,    setCopyInput]    = useState('');
  const [copyResult,   setCopyResult]   = useState<'ok' | 'failed' | null>(null);

  const childRef    = useRef<ChildProcess | null>(null);
  const mountedRef  = useRef(true);
  const maxScrollRef = useRef(0);

  const logBoxHeight = Math.max(5, rows - 12);
  const visibleLines = Math.max(3, logBoxHeight - 2);

  useEffect(() => {
    if (!copyResult) return;
    const t = setTimeout(() => setCopyResult(null), 2000);
    return () => clearTimeout(t);
  }, [copyResult]);

  useEffect(() => () => {
    mountedRef.current = false;
    childRef.current?.kill('SIGTERM');
  }, []);

  const launchTest = (db: string, type: TestType, value: string) => {
    const python   = join(service.versionPath, '.venv', 'bin', 'python3');
    const odooBin  = join(service.versionPath, 'community', 'odoo-bin');
    const testTag  = type === 'module' ? `/${value}` : value;
    const args     = [odooBin, '-c', service.confPath, '--addons-path', buildAddonsPaths(service).join(',')];
    if (db) args.push('-d', db);
    args.push('--test-tags', testTag, '--stop-after-init', '--no-http');

    setLogs([]);
    setExitCode(null);
    setScrollOffset(0);
    setPhase('running');

    const proc = spawn(python, args);
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
      if (mountedRef.current) setExitCode(code ?? -1);
    });
  };

  const handleValueSubmit = async (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    const db = dbInput.trim();

    if (testType === 'module') {
      setCheckError(null);
      setPhase('checking');
      try {
        const { found, paths } = await checkModuleExists(service, trimmed);
        if (!found) {
          setCheckError(`Module "${trimmed}" introuvable.`);
          setCheckedPaths(paths);
          setPhase('input_value');
          return;
        }
      } catch {
        setCheckError('Erreur lors de la vérification du module.');
        setCheckedPaths([]);
        setPhase('input_value');
        return;
      }
      launchTest(db, 'module', trimmed);
    } else {
      launchTest(db, 'tags', trimmed);
    }
  };

  // select_type
  useInput((_char, key) => {
    if (key.escape) { onBack(); return; }
    if (key.upArrow)   setTypeCursor(p => Math.max(0, p - 1));
    if (key.downArrow) setTypeCursor(p => Math.min(TYPE_OPTIONS.length - 1, p + 1));
    if (key.return) {
      setTestType(TYPE_OPTIONS[typeCursor]!.key);
      setCheckError(null);
      setValueInput('');
      setDbInput('');
      setPhase('input_db');
    }
  }, { isActive: phase === 'select_type' });

  // input_db
  useInput((_char, key) => {
    if (key.escape) setPhase('select_type');
  }, { isActive: phase === 'input_db' });

  // input_value
  useInput((_char, key) => {
    if (key.escape) { setCheckError(null); setPhase('input_db'); }
  }, { isActive: phase === 'input_value' });

  // checking — block all input
  useInput(() => {}, { isActive: phase === 'checking' });

  // running
  useInput((char, key) => {
    if (key.ctrl && char === 'u') { setCopyMode(true); setCopyInput(''); return; }
    if (key.upArrow)   { setScrollOffset(p => Math.min(maxScrollRef.current, p + 3)); return; }
    if (key.downArrow) { setScrollOffset(p => Math.max(0, p - 3)); return; }
    if (exitCode !== null) {
      if (key.escape || key.return) {
        setPhase('select_type');
        setLogs([]);
        setExitCode(null);
        setScrollOffset(0);
        setValueInput('');
        setDbInput('');
      }
      return;
    }
    if (key.ctrl && char === 'c') {
      childRef.current?.kill('SIGTERM');
    }
  }, { isActive: phase === 'running' && !copyMode });

  useInput((_char, key) => {
    if (key.escape) { setCopyMode(false); setCopyInput(''); }
  }, { isActive: phase === 'running' && copyMode });

  // ── Log window ────────────────────────────────────────────────────────────

  const maxScroll      = Math.max(0, logs.length - visibleLines);
  maxScrollRef.current = maxScroll;
  const offset         = Math.min(scrollOffset, maxScroll);
  const end            = logs.length - offset;
  const start          = Math.max(0, end - visibleLines);
  const visibleLogs    = logs.slice(start, end);

  // ── Running view ──────────────────────────────────────────────────────────

  if (phase === 'running') {
    const type   = testType;
    const tag    = type === 'module' ? `/${valueInput.trim()}` : valueInput.trim();
    const dbName = dbInput.trim();
    return (
      <Box flexGrow={1} flexDirection="column" paddingX={2} paddingY={1} gap={1}>
        <Box flexDirection="row" gap={2}>
          <Text color={getSecondaryColor(config)} bold>{service.name}</Text>
          <Text color="gray">--test-tags {tag}{dbName ? `  -d ${dbName}` : ''}</Text>
        </Box>

        <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column" height={logBoxHeight} overflow="hidden">
          {visibleLogs.length === 0 ? (
            <Text color={textColor} dimColor>Démarrage des tests…</Text>
          ) : (
            visibleLogs.map((line, i) => <LogLine key={start + i} line={line} idx={start + i} />)
          )}
        </Box>

        <Box>
          {copyMode ? (
            <Box flexDirection="row" gap={1}>
              <Text color="white">Copier les dernières</Text>
              <TextInput
                value={copyInput}
                onChange={setCopyInput}
                onSubmit={(val) => {
                  const n = parseInt(val, 10);
                  if (!isNaN(n) && n > 0) {
                    const result = copyToClipboard(logs.slice(-n).join('\n'));
                    setCopyResult(result);
                  }
                  setCopyMode(false);
                  setCopyInput('');
                }}
                placeholder="N"
              />
              <Text color="white">ligne(s)  ·  Échap annuler</Text>
            </Box>
          ) : exitCode === null ? (
            <Box flexDirection="row" gap={1}>
              {copyResult && <Text color={copyResult === 'ok' ? 'green' : 'red'}>{copyResult === 'ok' ? '✓ Copié !' : '✗ Échec'}</Text>}
              <Text color={textColor} dimColor>↑↓ scroller  ·  Ctrl+U copier  ·  Ctrl+C arrêter</Text>
            </Box>
          ) : exitCode === 0 ? (
            <Box flexDirection="row" gap={1}>
              {copyResult && <Text color={copyResult === 'ok' ? 'green' : 'red'}>{copyResult === 'ok' ? '✓ Copié !' : '✗ Échec'}</Text>}
              <Text color="green">✓ Tests terminés (code 0)  ·  Ctrl+U copier  ·  ↵/Échap retour</Text>
            </Box>
          ) : (
            <Box flexDirection="row" gap={1}>
              {copyResult && <Text color={copyResult === 'ok' ? 'green' : 'red'}>{copyResult === 'ok' ? '✓ Copié !' : '✗ Échec'}</Text>}
              <Text color="red">✗ Tests échoués (code {exitCode})  ·  Ctrl+U copier  ·  ↵/Échap retour</Text>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  // ── Setup views ───────────────────────────────────────────────────────────

  return (
    <Box flexDirection="row" flexGrow={1}>
      <LeftPanel width={leftWidth} primaryColor={getPrimaryColor(config)} textColor={textColor} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={getSecondaryColor(config)} bold>Tester · {service.name}</Text>

        {/* select_type */}
        {phase === 'select_type' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            {TYPE_OPTIONS.map((opt, i) => {
              const isSel = i === typeCursor;
              return (
                <Box key={opt.key} flexDirection="row" gap={2}>
                  <Text
                    color={isSel ? 'black' : 'white'}
                    backgroundColor={isSel ? cursorColor : undefined}
                    bold={isSel}
                  >
                    {` ${isSel ? '▶' : ' '} ${opt.label}  `}
                  </Text>
                  <Text color={textColor} dimColor>{opt.hint}</Text>
                </Box>
              );
            })}
            <Box marginTop={1}>
              <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour</Text>
            </Box>
          </Box>
        )}

        {/* input_db */}
        {phase === 'input_db' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="white">Base de données <Text color={textColor} dimColor>(optionnel, laisser vide pour utiliser la conf)</Text></Text>
            <Box borderStyle="round" borderColor="cyan" paddingX={1}>
              <TextInput
                value={dbInput}
                onChange={setDbInput}
                onSubmit={() => { setCheckError(null); setValueInput(''); setPhase('input_value'); }}
                placeholder="nom_de_la_base"
              />
            </Box>
            <Text color={textColor} dimColor>↵ continuer  ·  Échap retour</Text>
          </Box>
        )}

        {/* input_value */}
        {(phase === 'input_value' || phase === 'checking') && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            {dbInput.trim() && (
              <Text color={textColor} dimColor>base : {dbInput.trim()}</Text>
            )}
            <Text color="white">
              {testType === 'module'
                ? 'Nom du module'
                : 'Tags (séparés par des virgules)'}
            </Text>
            <Box borderStyle="round" borderColor={phase === 'checking' ? 'yellow' : 'cyan'} paddingX={1}>
              {phase === 'checking' ? (
                <Text color="yellow">Vérification du module…</Text>
              ) : (
                <TextInput
                  value={valueInput}
                  onChange={setValueInput}
                  onSubmit={handleValueSubmit}
                  placeholder={testType === 'module' ? 'mon_module' : 'standard,nuprod'}
                />
              )}
            </Box>
            {checkError && (
              <Box flexDirection="column" gap={0}>
                <Text color="red">✗ {checkError}</Text>
                {checkedPaths.map(p => (
                  <Text key={p} color="gray" dimColor>  {p}</Text>
                ))}
              </Box>
            )}
            {phase !== 'checking' && (
              <Text color={textColor} dimColor>↵ lancer les tests  ·  Échap retour</Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
