import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import {
  NupoConfig, OdooVersion,
  getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor,
  AnyStep, StepStatus,
} from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { StepsPanel } from '../components/StepsPanel.js';
import {
  listDumps, inspectDump, listDatabases, createDatabase,
  createTempDir, extractZip, spawnPsqlRestore, copyFilestore, removeTempDir, spawnNeutralize,
} from '../services/database.js';

interface RestoreScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
}

type Phase = 'select_dump' | 'db_name' | 'select_version' | 'running' | 'done' | 'error';

type RestoreStepId = 'create_db' | 'extract' | 'restore_sql' | 'copy_filestore' | 'neutralize' | 'cleanup';

const STEP_DEFS: { id: RestoreStepId; label: string }[] = [
  { id: 'create_db',       label: 'Création de la base de données' },
  { id: 'extract',         label: 'Extraction du dump' },
  { id: 'restore_sql',     label: 'Restauration SQL' },
  { id: 'copy_filestore',  label: 'Copie du filestore' },
  { id: 'neutralize',      label: 'Neutralisation de la base' },
  { id: 'cleanup',         label: 'Nettoyage dossier temporaire' },
];

function buildSteps(hasFilestore: boolean): AnyStep[] {
  return STEP_DEFS
    .filter(d => d.id !== 'copy_filestore' || hasFilestore)
    .map(d => ({ id: d.id, label: d.label, status: 'pending' as StepStatus }));
}


function patchStep(steps: AnyStep[], id: string, patch: Partial<AnyStep>): AnyStep[] {
  return steps.map(s => s.id === id ? { ...s, ...patch } : s);
}

const DB_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const MAX_LOG_LINES = 12;

export function RestoreScreen({ config, leftWidth, onBack }: RestoreScreenProps) {
  const { rows } = useTerminalSize();
  const primaryColor = getPrimaryColor(config);
  const secondaryColor = getSecondaryColor(config);
  const textColor = getTextColor(config);
  const cursorColor = getCursorColor(config);
  // title(1) + paddingY(4) + "Restauration..." label(1) + gaps(2) + borders(2) + StepsPanel(~8)
  const logBoxHeight = Math.max(4, rows - 18);

  const versions = Object.values(config.odoo_versions ?? {});

  const [phase, setPhase] = useState<Phase>('select_dump');
  const [dumps, setDumps] = useState<string[]>([]);
  const [dumpSelected, setDumpSelected] = useState(0);
  const [selectedDump, setSelectedDump] = useState('');
  const [hasFilestore, setHasFilestore] = useState(false);

  const [dbInput, setDbInput] = useState('');
  const [dbError, setDbError] = useState<string | null>(null);
  const [dbName, setDbName] = useState('');

  const [versionSelected, setVersionSelected] = useState(0);

  const [steps, setSteps] = useState<AnyStep[]>(buildSteps(false));
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Refs for async use
  const stepsRef = useRef<AnyStep[]>(steps);
  stepsRef.current = steps;
  const logsRef = useRef<string[]>(logs);
  logsRef.current = logs;

  // Load dumps on mount
  useEffect(() => {
    void listDumps(config.odoo_path_repo).then(list => {
      setDumps(list);
    });
  }, [config.odoo_path_repo]);

  const addLog = useCallback((line: string) => {
    setLogs(prev => {
      const next = [...prev, line];
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
    });
  }, []);

  const updateStep = useCallback((id: string, status: StepStatus, errorMessage?: string) => {
    setSteps(prev => patchStep(prev, id, { status, errorMessage }));
  }, []);

  // ── Phase: select_dump ──────────────────────────────────────────────────────

  useInput(
    (_char, key) => {
      if (key.escape) { onBack(); return; }
      if (dumps.length === 0) return;
      if (key.upArrow) setDumpSelected(p => Math.max(0, p - 1));
      if (key.downArrow) setDumpSelected(p => Math.min(dumps.length - 1, p + 1));
      if (key.return) {
        const dump = dumps[dumpSelected];
        if (!dump) return;
        const zipPath = join(config.odoo_path_repo, 'dumps', dump);
        void inspectDump(zipPath).then(info => {
          setSelectedDump(dump);
          setHasFilestore(info.hasFilestore);
          setPhase('db_name');
        });
      }
    },
    { isActive: phase === 'select_dump' },
  );

  // ── Phase: db_name ─────────────────────────────────────────────────────────

  const handleDbSubmit = useCallback(async (value: string) => {
    const name = value.trim();
    if (!name) { setDbError('Le nom ne peut pas être vide.'); return; }
    if (name.length > 63) { setDbError('Le nom ne peut pas dépasser 63 caractères.'); return; }
    if (!DB_NAME_RE.test(name)) {
      setDbError('Nom invalide : doit commencer par une lettre ou _ et ne contenir que lettres, chiffres, _.');
      return;
    }
    const existing = await listDatabases();
    if (existing.includes(name)) {
      setDbError(`La base "${name}" existe déjà.`);
      return;
    }
    setDbName(name);
    setPhase('select_version');
  }, []);

  useInput(
    (_char, key) => {
      if (key.escape) { setPhase('select_dump'); return; }
    },
    { isActive: phase === 'db_name' },
  );

  // ── Phase: select_version ──────────────────────────────────────────────────

  useInput(
    (_char, key) => {
      if (key.escape) { setPhase('db_name'); return; }
      if (key.upArrow) setVersionSelected(p => Math.max(0, p - 1));
      if (key.downArrow) setVersionSelected(p => Math.min(versions.length - 1, p + 1));
      if (key.return && versions[versionSelected]) {
        void runRestore(versions[versionSelected]!);
      }
    },
    { isActive: phase === 'select_version' },
  );

  // ── Phase: done / error ────────────────────────────────────────────────────

  useInput(
    (_char, key) => {
      if (key.escape || key.return) {
        // Reset to initial state
        setPhase('select_dump');
        setDumpSelected(0);
        setSelectedDump('');
        setHasFilestore(false);
        setDbInput('');
        setDbError(null);
        setDbName('');
        setVersionSelected(0);
        setSteps(buildSteps(false));
        setLogs([]);
        setErrorMsg(null);
      }
    },
    { isActive: phase === 'done' || phase === 'error' },
  );

  // ── Restore runner ─────────────────────────────────────────────────────────

  const runRestore = useCallback(async (version: OdooVersion) => {
    const zipPath = join(config.odoo_path_repo, 'dumps', selectedDump);
    const tempDir = createTempDir();
    const currentSteps = buildSteps(hasFilestore);
    setSteps(currentSteps);
    setLogs([]);
    setErrorMsg(null);
    setPhase('running');

    // Helper: update steps state from outside react cycle
    const update = (id: string, status: StepStatus, errorMessage?: string) => {
      setSteps(prev => patchStep(prev, id, { status, errorMessage }));
    };

    // 1. create_db
    update('create_db', 'running');
    const dbResult = await createDatabase(dbName);
    if (!dbResult.ok) {
      update('create_db', 'error', dbResult.error);
      setErrorMsg(dbResult.error ?? 'Échec création base');
      setPhase('error');
      return;
    }
    update('create_db', 'success');

    // 2. extract
    update('extract', 'running');
    try { await mkdir(tempDir, { recursive: true }); } catch { /* ignore */ }
    const extractResult = await extractZip(zipPath, tempDir, addLog);
    if (!extractResult.ok) {
      update('extract', 'error', extractResult.error);
      setErrorMsg(extractResult.error ?? 'Échec extraction');
      await removeTempDir(tempDir);
      setPhase('error');
      return;
    }
    update('extract', 'success');

    // 3. restore_sql
    update('restore_sql', 'running');
    const dumpSqlPath = join(tempDir, 'dump.sql');
    const psqlResult = await spawnPsqlRestore(dbName, dumpSqlPath, addLog);
    if (!psqlResult.ok) {
      update('restore_sql', 'error', psqlResult.error);
      setErrorMsg(psqlResult.error ?? 'Échec restauration SQL');
      await removeTempDir(tempDir);
      setPhase('error');
      return;
    }
    update('restore_sql', 'success');

    // 4. copy_filestore (conditional)
    if (hasFilestore) {
      update('copy_filestore', 'running');
      const srcFilestore = join(tempDir, 'filestore');
      const destFilestore = join(version.path, 'datas', 'filestore', dbName);
      const cpResult = await copyFilestore(srcFilestore, destFilestore);
      if (!cpResult.ok) {
        update('copy_filestore', 'error', cpResult.error);
        setErrorMsg(cpResult.error ?? 'Échec copie filestore');
        await removeTempDir(tempDir);
        setPhase('error');
        return;
      }
      update('copy_filestore', 'success');
    }

    // 5. neutralize
    update('neutralize', 'running');
    const neutralizeResult = await spawnNeutralize(dbName, version.path);
    if (!neutralizeResult.ok) {
      update('neutralize', 'error', neutralizeResult.error);
      setErrorMsg(neutralizeResult.error ?? 'Échec neutralisation');
      await removeTempDir(tempDir);
      setPhase('error');
      return;
    }
    update('neutralize', 'success');

    // 6. cleanup
    update('cleanup', 'running');
    await removeTempDir(tempDir);
    update('cleanup', 'success');

    setPhase('done');
  }, [config.odoo_path_repo, selectedDump, hasFilestore, dbName, addLog]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="row" flexGrow={1}>
        <LeftPanel width={leftWidth} primaryColor={primaryColor} textColor={textColor} />

        <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
          <Text color={secondaryColor} bold>Restaurer une base</Text>

          {/* Phase: select_dump */}
          {phase === 'select_dump' && (
            <Box flexDirection="column" gap={1} marginTop={1}>
              {dumps.length === 0 ? (
                <>
                  <Text color="yellow">Aucun fichier .zip trouvé dans dumps/.</Text>
                  <Text color={textColor} dimColor>
                    {`Placez un fichier .zip dans : ${join(config.odoo_path_repo, 'dumps')}`}
                  </Text>
                  <Text color={textColor} dimColor>Échap retour</Text>
                </>
              ) : (
                <>
                  <Text color={textColor} dimColor>Sélectionnez un fichier dump :</Text>
                  <Box flexDirection="column" gap={0}>
                    {dumps.map((d, i) => {
                      const isSel = i === dumpSelected;
                      return (
                        <Text
                          key={d}
                          color={isSel ? 'black' : 'white'}
                          backgroundColor={isSel ? cursorColor : undefined}
                          bold={isSel}
                        >
                          {` ${isSel ? '▶' : ' '} ${d}`}
                        </Text>
                      );
                    })}
                  </Box>
                  <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour</Text>
                </>
              )}
            </Box>
          )}

          {/* Phase: db_name */}
          {phase === 'db_name' && (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text color={textColor} dimColor>
                {'Dump : '}
                <Text color="white">{selectedDump}</Text>
                {hasFilestore ? '  (filestore inclus)' : ''}
              </Text>
              <Text color="white">Nom de la base de données à créer :</Text>
              <Box>
                <Text color={textColor} dimColor>{'› '}</Text>
                <TextInput
                  value={dbInput}
                  onChange={v => { setDbInput(v); setDbError(null); }}
                  onSubmit={handleDbSubmit}
                  placeholder="ma_base"
                />
              </Box>
              {dbError && <Text color="red">{dbError}</Text>}
              <Text color={textColor} dimColor>↵ valider  ·  Échap retour</Text>
            </Box>
          )}

          {/* Phase: select_version */}
          {phase === 'select_version' && (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text color={textColor} dimColor>
                {'Base : '}
                <Text color="white">{dbName}</Text>
              </Text>
              {versions.length === 0 ? (
                <>
                  <Text color="yellow">Aucune version Odoo installée.</Text>
                  <Text color={textColor} dimColor>Échap retour</Text>
                </>
              ) : (
                <>
                  <Text color={textColor} dimColor>Sélectionnez la version Odoo (pour le filestore) :</Text>
                  <Box flexDirection="column" gap={0}>
                    {versions.map((v, i) => {
                      const isSel = i === versionSelected;
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
                  <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ lancer  ·  Échap retour</Text>
                </>
              )}
            </Box>
          )}

          {/* Phase: running */}
          {phase === 'running' && (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text color={textColor}>
                {'Restauration de '}
                <Text color={primaryColor} bold>{dbName}</Text>
                {'…'}
              </Text>
              <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="gray"
                paddingX={1}
                height={logBoxHeight}
                overflow="hidden"
              >
                {logs.length === 0 ? (
                  <Text color={textColor} dimColor>En attente…</Text>
                ) : (
                  logs.map((line, i) => (
                    <Text key={i} color={textColor} dimColor wrap="truncate-end">{line}</Text>
                  ))
                )}
              </Box>
            </Box>
          )}

          {/* Phase: done */}
          {phase === 'done' && (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text color="green">
                {'✓ Base '}
                <Text bold>{dbName}</Text>
                {' restaurée avec succès.'}
              </Text>
              <Text color={textColor} dimColor>↵/Échap pour réinitialiser</Text>
            </Box>
          )}

          {/* Phase: error */}
          {phase === 'error' && (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text color="red">
                {'✗ Erreur lors de la restauration de '}
                <Text bold>{dbName}</Text>
                {'.'}
              </Text>
              {errorMsg && (
                <Box borderStyle="round" borderColor="red" paddingX={1}>
                  <Text color="red" wrap="wrap">{errorMsg}</Text>
                </Box>
              )}
              <Text color={textColor} dimColor>↵/Échap pour réinitialiser</Text>
            </Box>
          )}
        </Box>
      </Box>

      {(phase === 'running' || phase === 'done' || phase === 'error') && (
        <StepsPanel steps={steps} textColor={textColor} />
      )}
    </Box>
  );
}
