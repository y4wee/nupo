import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { cpus } from 'node:os';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import {
  NupoConfig, OdooVersion,
  getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor,
  AnyStep, StepStatus, sortedOdooVersions,
} from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { StepsPanel } from '../components/StepsPanel.js';
import {
  DumpEntry, listDumps, listDumpsFromPath, inspectDump, listDatabases, createDatabase,
  createTempDir, extractZip, spawnPsqlRestore, spawnPgRestore,
  copyFilestore, removeTempDir, spawnNeutralize,
} from '../services/database.js';

interface RestoreScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
}

type Phase = 'select_dump' | 'db_name' | 'select_jobs' | 'select_version' | 'running' | 'done' | 'error';

type RestoreStepId = 'create_db' | 'extract' | 'restore_sql' | 'copy_filestore' | 'neutralize' | 'cleanup';

const STEP_DEFS: { id: RestoreStepId; label: string }[] = [
  { id: 'create_db',       label: 'Création de la base de données' },
  { id: 'extract',         label: 'Extraction du dump' },
  { id: 'restore_sql',     label: 'Restauration SQL' },
  { id: 'copy_filestore',  label: 'Copie du filestore' },
  { id: 'neutralize',      label: 'Neutralisation de la base' },
  { id: 'cleanup',         label: 'Nettoyage dossier temporaire' },
];

type RestoreMode = 'zip' | 'dump' | 'sql';

function buildSteps(hasFilestore: boolean, mode: RestoreMode): AnyStep[] {
  return STEP_DEFS
    .filter(d => {
      if (mode === 'dump' || mode === 'sql') return d.id === 'create_db' || d.id === 'restore_sql';
      if (d.id === 'copy_filestore') return hasFilestore;
      return true;
    })
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
  const logBoxHeight = Math.max(4, rows - 18);

  const versions = sortedOdooVersions(Object.values(config.odoo_versions ?? {}));
  const maxJobs = cpus().length;

  const [phase, setPhase] = useState<Phase>('select_dump');
  const [dumps, setDumps] = useState<DumpEntry[]>([]);
  const [dumpSearch, setDumpSearch] = useState('');
  const [dumpSelected, setDumpSelected] = useState(0);
  const [selectedDump, setSelectedDump] = useState('');
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('zip');
  const [hasFilestore, setHasFilestore] = useState(false);

  const [dbInput, setDbInput] = useState('');
  const [dbError, setDbError] = useState<string | null>(null);
  const [dbName, setDbName] = useState('');
  const dbNameRef = useRef('');

  const [jobCount, setJobCount] = useState(1);
  const jobCountRef = useRef(1);

  const [versionSelected, setVersionSelected] = useState(0);

  const [steps, setSteps] = useState<AnyStep[]>(buildSteps(false, 'zip'));
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stepsRef = useRef<AnyStep[]>(steps);
  stepsRef.current = steps;
  const restoreModeRef = useRef<RestoreMode>('zip');
  const selectedDumpRef = useRef('');
  const hasFilestoreRef = useRef(false);

  useEffect(() => {
    const dumpsDir = join(config.odoo_path_repo, 'dumps');
    void mkdir(dumpsDir, { recursive: true }).then(async () => {
      const standard = await listDumps(config.odoo_path_repo);
      const extra = config.dump_path?.trim()
        ? await listDumpsFromPath(config.dump_path.trim())
        : [];
      setDumps([...standard, ...extra]);
    });
  }, [config.odoo_path_repo, config.dump_path]);

  const addLog = useCallback((line: string) => {
    setLogs(prev => {
      const next = [...prev, line];
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
    });
  }, []);

  const resetState = useCallback(() => {
    setPhase('select_dump');
    setDumpSearch('');
    setDumpSelected(0);
    setSelectedDump('');
    setRestoreMode('zip');
    setHasFilestore(false);
    setDbInput('');
    setDbError(null);
    setDbName('');
    setJobCount(1);
    jobCountRef.current = 1;
    setVersionSelected(0);
    setSteps(buildSteps(false, 'zip'));
    setLogs([]);
    setErrorMsg(null);
    restoreModeRef.current = 'zip';
    selectedDumpRef.current = '';
    hasFilestoreRef.current = false;
    dbNameRef.current = '';
  }, []);

  // ── Phase: select_dump ──────────────────────────────────────────────────────

  const filteredDumps = dumpSearch
    ? dumps.filter(d => d.name.toLowerCase().includes(dumpSearch.toLowerCase()))
    : dumps;

  useInput(
    (char, key) => {
      if (key.escape) {
        if (dumpSearch) { setDumpSearch(''); setDumpSelected(0); return; }
        onBack();
        return;
      }
      if (key.backspace || key.delete) { setDumpSearch(p => p.slice(0, -1)); setDumpSelected(0); return; }
      if (char && !key.ctrl && !key.meta && char >= ' ') { setDumpSearch(p => p + char); setDumpSelected(0); return; }
      if (filteredDumps.length === 0) return;
      if (key.upArrow) setDumpSelected(p => Math.max(0, p - 1));
      if (key.downArrow) setDumpSelected(p => Math.min(filteredDumps.length - 1, p + 1));
      if (key.return) {
        const entry = filteredDumps[dumpSelected];
        if (!entry) return;
        const lc = entry.name.toLowerCase();
        const mode: RestoreMode = lc.endsWith('.dump') ? 'dump' : lc.endsWith('.sql') ? 'sql' : 'zip';
        setSelectedDump(entry.name);
        selectedDumpRef.current = entry.fullPath;
        setRestoreMode(mode);
        restoreModeRef.current = mode;
        if (mode !== 'zip') {
          setHasFilestore(false);
          hasFilestoreRef.current = false;
          setPhase('db_name');
        } else {
          void inspectDump(entry.fullPath).then(info => {
            setHasFilestore(info.hasFilestore);
            hasFilestoreRef.current = info.hasFilestore;
            setPhase('db_name');
          });
        }
      }
    },
    { isActive: phase === 'select_dump' },
  );

  // ── Phase: db_name ─────────────────────────────────────────────────────────

  useInput(
    (_char, key) => {
      if (key.escape) { setPhase('select_dump'); return; }
    },
    { isActive: phase === 'db_name' },
  );

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
    dbNameRef.current = name;
    if (restoreModeRef.current === 'dump') {
      setJobCount(1);
      jobCountRef.current = 1;
      setPhase('select_jobs');
    } else if (restoreModeRef.current === 'sql') {
      void runRestoreDump(name);
    } else {
      setPhase('select_version');
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Phase: select_jobs (.dump only) ───────────────────────────────────────

  useInput(
    (_char, key) => {
      if (key.escape) { setPhase('db_name'); return; }
      if (key.leftArrow || key.downArrow) {
        setJobCount(p => {
          const v = Math.max(1, p - 1);
          jobCountRef.current = v;
          return v;
        });
      }
      if (key.rightArrow || key.upArrow) {
        setJobCount(p => {
          const v = Math.min(maxJobs, p + 1);
          jobCountRef.current = v;
          return v;
        });
      }
      if (key.return) {
        void runRestoreDump(dbNameRef.current);
      }
    },
    { isActive: phase === 'select_jobs' },
  );

  // ── Phase: select_version (zip only) ───────────────────────────────────────

  useInput(
    (_char, key) => {
      if (key.escape) { setPhase('db_name'); return; }
      if (key.upArrow) setVersionSelected(p => Math.max(0, p - 1));
      if (key.downArrow) setVersionSelected(p => Math.min(versions.length - 1, p + 1));
      if (key.return && versions[versionSelected]) {
        void runRestoreZip(versions[versionSelected]!);
      }
    },
    { isActive: phase === 'select_version' },
  );

  // ── Phase: done / error ────────────────────────────────────────────────────

  useInput(
    (_char, key) => {
      if (key.escape || key.return) resetState();
    },
    { isActive: phase === 'done' || phase === 'error' },
  );

  // ── Restore .dump (pg_restore, no filestore, no neutralize) ────────────────

  const runRestoreDump = useCallback(async (name: string) => {
    const dumpPath = selectedDumpRef.current;
    const mode = restoreModeRef.current;
    const currentSteps = buildSteps(false, mode);
    setSteps(currentSteps);
    setLogs([]);
    setErrorMsg(null);
    setPhase('running');

    const update = (id: string, status: StepStatus, errorMessage?: string) => {
      setSteps(prev => patchStep(prev, id, { status, errorMessage }));
    };

    // 1. create_db
    update('create_db', 'running');
    const dbResult = await createDatabase(name);
    if (!dbResult.ok) {
      update('create_db', 'error', dbResult.error);
      setErrorMsg(dbResult.error ?? 'Échec création base');
      setPhase('error');
      return;
    }
    update('create_db', 'success');

    // 2. restore_sql — psql pour .sql, pg_restore pour .dump
    update('restore_sql', 'running');
    const restoreResult = mode === 'sql'
      ? await spawnPsqlRestore(name, dumpPath, addLog)
      : await spawnPgRestore(name, dumpPath, addLog, jobCountRef.current);
    if (!restoreResult.ok) {
      update('restore_sql', 'error', restoreResult.error);
      setErrorMsg(restoreResult.error ?? 'Échec restauration');
      setPhase('error');
      return;
    }
    update('restore_sql', 'success');

    setPhase('done');
  }, [addLog]);

  // ── Restore .zip (extract → psql → filestore → neutralize → cleanup) ───────

  const runRestoreZip = useCallback(async (version: OdooVersion) => {
    const zipPath = selectedDumpRef.current;
    const name = dbNameRef.current;
    const fsFlag = hasFilestoreRef.current;
    const tempDir = createTempDir();
    const currentSteps = buildSteps(fsFlag, 'zip');
    setSteps(currentSteps);
    setLogs([]);
    setErrorMsg(null);
    setPhase('running');

    const update = (id: string, status: StepStatus, errorMessage?: string) => {
      setSteps(prev => patchStep(prev, id, { status, errorMessage }));
    };

    // 1. create_db
    update('create_db', 'running');
    const dbResult = await createDatabase(name);
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
    const psqlResult = await spawnPsqlRestore(name, dumpSqlPath, addLog);
    if (!psqlResult.ok) {
      update('restore_sql', 'error', psqlResult.error);
      setErrorMsg(psqlResult.error ?? 'Échec restauration SQL');
      await removeTempDir(tempDir);
      setPhase('error');
      return;
    }
    update('restore_sql', 'success');

    // 4. copy_filestore (conditional)
    if (fsFlag) {
      update('copy_filestore', 'running');
      const srcFilestore = join(tempDir, 'filestore');
      const destFilestore = join(version.path, 'datas', 'filestore', name);
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
    const neutralizeResult = await spawnNeutralize(name, version.path);
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
  }, [addLog]);

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
                  <Text color="yellow">Aucun fichier .zip, .dump ou .sql trouvé dans dumps/.</Text>
                  <Text color={textColor} dimColor>
                    {`Placez un fichier dans : ${join(config.odoo_path_repo, 'dumps')}`}
                  </Text>
                  <Text color={textColor} dimColor>Échap retour</Text>
                </>
              ) : (
                <>
                  <Box borderStyle="round" borderColor={dumpSearch ? 'cyan' : 'gray'} paddingX={1} flexDirection="row" gap={1}>
                    <Text color={textColor} dimColor>{'🔍'}</Text>
                    {dumpSearch
                      ? <Text color="white">{dumpSearch}</Text>
                      : <Text color={textColor} dimColor>Rechercher…</Text>
                    }
                  </Box>
                  {filteredDumps.length === 0 ? (
                    <Text color={textColor} dimColor>{`  Aucun fichier correspondant à "${dumpSearch}"`}</Text>
                  ) : (
                    <Box flexDirection="column" gap={0}>
                      {filteredDumps.map((d, i) => {
                        const isSel = i === dumpSelected;
                        return (
                          <Box key={d.fullPath} flexDirection="row" gap={1}>
                            <Text
                              color={isSel ? 'black' : 'white'}
                              backgroundColor={isSel ? cursorColor : undefined}
                              bold={isSel}
                            >
                              {` ${isSel ? '▶' : ' '} ${d.name}`}
                            </Text>
                            <Text
                              color={isSel ? 'black' : textColor}
                              backgroundColor={isSel ? cursorColor : undefined}
                              dimColor={!isSel}
                            >
                              {`[${d.folder}]`}
                            </Text>
                          </Box>
                        );
                      })}
                    </Box>
                  )}
                  <Text color={textColor} dimColor>
                    {'↑↓ naviguer  ·  ↵ sélectionner  ·  Échap '}
                    {dumpSearch ? 'effacer filtre' : 'retour'}
                  </Text>
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
                {restoreMode === 'zip' && hasFilestore ? '  (filestore inclus)' : ''}
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

          {/* Phase: select_jobs (.dump only) */}
          {phase === 'select_jobs' && (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text color={textColor} dimColor>
                {'Dump : '}
                <Text color="white">{selectedDump}</Text>
              </Text>
              <Text color="white">Nombre de workers pour la restauration :</Text>
              <Box flexDirection="row" gap={2} alignItems="center">
                <Text color={textColor} dimColor>{'◀ '}</Text>
                <Text color={primaryColor} bold>{` ${jobCount} `}</Text>
                <Text color={textColor} dimColor>{' ▶'}</Text>
                <Text color={textColor} dimColor>{`  (max : ${maxJobs} cœurs)`}</Text>
              </Box>
              {jobCount === maxJobs && (
                <Text color="yellow" dimColor>{'  ⚠ tous les cœurs utilisés — peut ralentir le système'}</Text>
              )}
              <Text color={textColor} dimColor>{'◀▶ ajuster  ·  ↵ lancer  ·  Échap retour'}</Text>
            </Box>
          )}

          {/* Phase: select_version (zip only) */}
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
                  <Text color={textColor} dimColor>Sélectionnez la version Odoo (pour le filestore et la neutralisation) :</Text>
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
                <Text color={primaryColor} bold>{dbName || dbNameRef.current}</Text>
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
                <Text bold>{dbName || dbNameRef.current}</Text>
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
                <Text bold>{dbName || dbNameRef.current}</Text>
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
