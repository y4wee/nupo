import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { NupoConfig, getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor } from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { listFilestoreDatabases, spawnMigration, FilestoreEntry } from '../services/database.js';

interface MigrationScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
}

type MigrationPhase =
  | 'select_db'
  | 'select_version'
  | 'select_type'
  | 'enter_code'
  | 'confirm'
  | 'running'
  | 'done'
  | 'error';

const ALL_VERSIONS = ['14.0', '15.0', '16.0', '17.0', '18.0', '19.0'];

function targetVersions(currentBranch: string): string[] {
  return ALL_VERSIONS.filter(v => parseFloat(v) > parseFloat(currentBranch));
}

export function MigrationScreen({ config, leftWidth, onBack }: MigrationScreenProps) {
  const primaryColor = getPrimaryColor(config);
  const secondaryColor = getSecondaryColor(config);
  const textColor = getTextColor(config);
  const cursorColor = getCursorColor(config);

  const [phase, setPhase] = useState<MigrationPhase>('select_db');

  // DB list
  const [dbLoading, setDbLoading] = useState(true);
  const [databases, setDatabases] = useState<FilestoreEntry[]>([]);
  const [dbSel, setDbSel] = useState(0);
  const [selectedDb, setSelectedDb] = useState<FilestoreEntry | null>(null);

  // Version selection
  const [versions, setVersions] = useState<string[]>([]);
  const [versionSel, setVersionSel] = useState(0);
  const [selectedVersion, setSelectedVersion] = useState('');

  // Type selection (0=test, 1=production)
  const [typeSel, setTypeSel] = useState(0);
  const [selectedType, setSelectedType] = useState<'test' | 'production'>('test');

  // Enterprise code
  const [enterpriseCode, setEnterpriseCode] = useState('');
  const [codeError, setCodeError] = useState('');

  // Running output
  const [lines, setLines] = useState<string[]>([]);
  const [migrationOk, setMigrationOk] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Load databases
  useEffect(() => {
    void listFilestoreDatabases(Object.values(config.odoo_versions ?? {})).then(list => {
      setDatabases(list);
      setDbSel(0);
      setDbLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── select_db ─────────────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { onBack(); return; }
    if (dbLoading || databases.length === 0) return;
    if (key.upArrow) setDbSel(p => Math.max(0, p - 1));
    if (key.downArrow) setDbSel(p => Math.min(databases.length - 1, p + 1));
    if (key.return) {
      const db = databases[dbSel];
      if (!db) return;
      const targets = targetVersions(db.versionBranch);
      if (targets.length === 0) return; // no upgradeable versions
      setSelectedDb(db);
      setVersions(targets);
      setVersionSel(0);
      setPhase('select_version');
    }
  }, { isActive: phase === 'select_db' });

  // ── select_version ────────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { setPhase('select_db'); return; }
    if (key.upArrow) setVersionSel(p => Math.max(0, p - 1));
    if (key.downArrow) setVersionSel(p => Math.min(versions.length - 1, p + 1));
    if (key.return) {
      setSelectedVersion(versions[versionSel]!);
      setTypeSel(0);
      setPhase('select_type');
    }
  }, { isActive: phase === 'select_version' });

  // ── select_type ───────────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { setPhase('select_version'); return; }
    if (key.upArrow || key.leftArrow) setTypeSel(0);
    if (key.downArrow || key.rightArrow) setTypeSel(1);
    if (key.return) {
      const type = typeSel === 0 ? 'test' : 'production';
      setSelectedType(type);
      if (type === 'production') {
        setEnterpriseCode('');
        setCodeError('');
        setPhase('enter_code');
      } else {
        setPhase('confirm');
      }
    }
  }, { isActive: phase === 'select_type' });

  // ── enter_code ────────────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { setPhase('select_type'); return; }
    if (key.return) {
      if (!enterpriseCode.trim()) {
        setCodeError('Le code Enterprise est requis.');
        return;
      }
      setCodeError('');
      setPhase('confirm');
    }
  }, { isActive: phase === 'enter_code' });

  // ── confirm ───────────────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) {
      setPhase(selectedType === 'production' ? 'enter_code' : 'select_type');
      return;
    }
    if (key.return) void runMigration();
  }, { isActive: phase === 'confirm' });

  // ── done / error ──────────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape || key.return) onBack();
  }, { isActive: phase === 'done' || phase === 'error' });

  // ── runner ────────────────────────────────────────────────────────────────

  const runMigration = useCallback(async () => {
    if (!selectedDb) return;
    setLines([]);
    setMigrationOk(null);
    setErrorMsg('');
    setPhase('running');

    const result = await spawnMigration(
      selectedDb.dbName,
      selectedVersion,
      selectedType,
      selectedType === 'production' ? enterpriseCode.trim() : undefined,
      line => setLines(prev => [...prev.slice(-100), line]),
    );

    setMigrationOk(result.ok);
    setErrorMsg(result.error ?? '');
    setPhase(result.ok ? 'done' : 'error');
  }, [selectedDb, selectedVersion, selectedType, enterpriseCode]);

  // ── render ────────────────────────────────────────────────────────────────

  const currentDb = databases[dbSel];

  return (
    <Box flexDirection="row" flexGrow={1}>
      <LeftPanel width={leftWidth} primaryColor={primaryColor} textColor={textColor} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={secondaryColor} bold>Migration de base</Text>

        {/* select_db */}
        {phase === 'select_db' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            {dbLoading ? (
              <Text color={textColor} dimColor>Chargement…</Text>
            ) : databases.length === 0 ? (
              <>
                <Text color="yellow">Aucune base trouvée dans les filestores.</Text>
                <Text color={textColor} dimColor>Échap retour</Text>
              </>
            ) : (
              <>
                <Text color={textColor} dimColor>Sélectionnez une base à migrer :</Text>
                <Box flexDirection="column" gap={0}>
                  {databases.map((db, i) => {
                    const isSel = i === dbSel;
                    const noTargets = targetVersions(db.versionBranch).length === 0;
                    return (
                      <Box key={`${db.versionBranch}/${db.dbName}`} flexDirection="row">
                        <Text
                          color={noTargets ? 'gray' : isSel ? 'black' : 'white'}
                          backgroundColor={isSel && !noTargets ? cursorColor : undefined}
                          bold={isSel && !noTargets}
                        >
                          {` ${isSel && !noTargets ? '▶' : ' '} ${db.dbName}`}
                        </Text>
                        <Text
                          color={isSel && !noTargets ? 'black' : textColor}
                          backgroundColor={isSel && !noTargets ? cursorColor : undefined}
                          dimColor={!(isSel && !noTargets)}
                        >
                          {`  [${db.versionBranch}]`}
                        </Text>
                        {noTargets && (
                          <Text color="gray" dimColor>{'  (déjà à la version max)'}</Text>
                        )}
                      </Box>
                    );
                  })}
                </Box>
                <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour</Text>
              </>
            )}
          </Box>
        )}

        {/* select_version */}
        {phase === 'select_version' && selectedDb && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Box flexDirection="row" gap={1}>
              <Text color={textColor} dimColor>Base :</Text>
              <Text color="white" bold>{selectedDb.dbName}</Text>
              <Text color={textColor} dimColor>({selectedDb.versionBranch})</Text>
            </Box>
            <Text color={textColor} dimColor>Sélectionnez la version cible :</Text>
            <Box flexDirection="column" gap={0}>
              {versions.map((v, i) => {
                const isSel = i === versionSel;
                return (
                  <Text
                    key={v}
                    color={isSel ? 'black' : 'white'}
                    backgroundColor={isSel ? cursorColor : undefined}
                    bold={isSel}
                  >
                    {` ${isSel ? '▶' : ' '} Odoo ${v}`}
                  </Text>
                );
              })}
            </Box>
            <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour</Text>
          </Box>
        )}

        {/* select_type */}
        {phase === 'select_type' && selectedDb && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Box flexDirection="row" gap={1}>
              <Text color={textColor} dimColor>Base :</Text>
              <Text color="white" bold>{selectedDb.dbName}</Text>
              <Text color={textColor} dimColor>→ Odoo</Text>
              <Text color={primaryColor} bold>{selectedVersion}</Text>
            </Box>
            <Text color={textColor} dimColor>Type de migration :</Text>
            <Box flexDirection="column" gap={0}>
              {(['test', 'production'] as const).map((t, i) => {
                const isSel = i === typeSel;
                return (
                  <Text
                    key={t}
                    color={isSel ? 'black' : 'white'}
                    backgroundColor={isSel ? cursorColor : undefined}
                    bold={isSel}
                  >
                    {` ${isSel ? '▶' : ' '} ${t === 'test' ? 'Test' : 'Production'}`}
                  </Text>
                );
              })}
            </Box>
            <Text color={textColor} dimColor>↑↓ choisir  ·  ↵ valider  ·  Échap retour</Text>
          </Box>
        )}

        {/* enter_code */}
        {phase === 'enter_code' && selectedDb && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Box flexDirection="row" gap={1}>
              <Text color={textColor} dimColor>Base :</Text>
              <Text color="white" bold>{selectedDb.dbName}</Text>
              <Text color={textColor} dimColor>→ Odoo</Text>
              <Text color={primaryColor} bold>{selectedVersion}</Text>
              <Text color="yellow" bold>· Production</Text>
            </Box>
            <Text color={textColor} dimColor>Code Enterprise :</Text>
            <Box flexDirection="row" gap={1}>
              <Text color={primaryColor}>{'> '}</Text>
              <TextInput value={enterpriseCode} onChange={setEnterpriseCode} />
            </Box>
            {codeError ? <Text color="red">{codeError}</Text> : null}
            <Text color={textColor} dimColor>↵ valider  ·  Échap retour</Text>
          </Box>
        )}

        {/* confirm */}
        {phase === 'confirm' && selectedDb && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color={secondaryColor} bold>Confirmer la migration</Text>
            <Box flexDirection="column" gap={0} marginTop={1}>
              <Box flexDirection="row" gap={1}>
                <Text color={textColor} dimColor>Base         :</Text>
                <Text color="white" bold>{selectedDb.dbName}</Text>
              </Box>
              <Box flexDirection="row" gap={1}>
                <Text color={textColor} dimColor>Version actuelle :</Text>
                <Text color="white">{selectedDb.versionBranch}</Text>
              </Box>
              <Box flexDirection="row" gap={1}>
                <Text color={textColor} dimColor>Version cible    :</Text>
                <Text color={primaryColor} bold>{selectedVersion}</Text>
              </Box>
              <Box flexDirection="row" gap={1}>
                <Text color={textColor} dimColor>Type         :</Text>
                <Text color={selectedType === 'production' ? 'yellow' : 'cyan'} bold>
                  {selectedType === 'test' ? 'Test' : 'Production'}
                </Text>
              </Box>
              {selectedType === 'production' && (
                <Box flexDirection="row" gap={1}>
                  <Text color={textColor} dimColor>Code Enterprise  :</Text>
                  <Text color="white">{enterpriseCode}</Text>
                </Box>
              )}
            </Box>
            <Box marginTop={1}><Text color={textColor} dimColor>↵ lancer la migration  ·  Échap annuler</Text></Box>
          </Box>
        )}

        {/* running */}
        {phase === 'running' && selectedDb && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color={textColor}>
              {'Migration de '}
              <Text color={primaryColor} bold>{selectedDb.dbName}</Text>
              {' → Odoo '}
              <Text color={primaryColor} bold>{selectedVersion}</Text>
              {'…'}
            </Text>
            <Box flexDirection="column" gap={0} borderStyle="round" borderColor={textColor} paddingX={1}>
              {lines.slice(-20).map((l, i) => (
                <Text key={i} color="white" dimColor wrap="truncate-end">{l}</Text>
              ))}
              {lines.length === 0 && <Text color={textColor} dimColor>En attente de sortie…</Text>}
            </Box>
          </Box>
        )}

        {/* done */}
        {phase === 'done' && selectedDb && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="green" bold>
              {'✓ Migration de '}
              <Text bold>{selectedDb.dbName}</Text>
              {` vers Odoo ${selectedVersion} terminée avec succès.`}
            </Text>
            <Text color={textColor} dimColor>↵/Échap retour</Text>
          </Box>
        )}

        {/* error */}
        {phase === 'error' && selectedDb && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="red" bold>✗ La migration a échoué.</Text>
            {errorMsg ? (
              <Box borderStyle="round" borderColor="red" paddingX={1}>
                <Text color="red" wrap="wrap">{errorMsg}</Text>
              </Box>
            ) : null}
            <Text color={textColor} dimColor>↵/Échap retour</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
