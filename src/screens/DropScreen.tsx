import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { NupoConfig, getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor } from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import {
  listFilestoreDatabases, dropDatabase, removeFilestoreEntry,
  FilestoreEntry,
} from '../services/database.js';

interface DropScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
}

type DropPhase = 'select' | 'confirm' | 'running' | 'done' | 'error';

export function DropScreen({ config, leftWidth, onBack }: DropScreenProps) {
  const primaryColor = getPrimaryColor(config);
  const secondaryColor = getSecondaryColor(config);
  const textColor = getTextColor(config);
  const cursorColor = getCursorColor(config);

  const versions = Object.values(config.odoo_versions ?? {});

  const [phase, setPhase] = useState<DropPhase>('select');
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<FilestoreEntry[]>([]);
  const [selected, setSelected] = useState(0);
  const [confirmSel, setConfirmSel] = useState(1); // 0=Oui 1=Non
  const [dropPsqlOk, setDropPsqlOk] = useState<boolean | null>(null);
  const [dropFsOk, setDropFsOk] = useState<boolean | null>(null);
  const [dropPsqlErr, setDropPsqlErr] = useState('');
  const [dropFsErr, setDropFsErr] = useState('');

  const loadEntries = useCallback(() => {
    setLoading(true);
    void listFilestoreDatabases(versions).then(list => {
      setEntries(list);
      setSelected(0);
      setLoading(false);
    });
  }, [versions]);

  useEffect(() => {
    loadEntries();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const currentEntry = entries[selected];

  // ── select ────────────────────────────────────────────────────────────────

  useInput(
    (_char, key) => {
      if (key.escape) { onBack(); return; }
      if (loading || entries.length === 0) return;
      if (key.upArrow) setSelected(p => Math.max(0, p - 1));
      if (key.downArrow) setSelected(p => Math.min(entries.length - 1, p + 1));
      if (key.return && currentEntry) {
        setConfirmSel(1);
        setPhase('confirm');
      }
    },
    { isActive: phase === 'select' },
  );

  // ── confirm ───────────────────────────────────────────────────────────────

  useInput(
    (_char, key) => {
      if (key.escape || (key.rightArrow && confirmSel === 1)) {
        setPhase('select');
        return;
      }
      if (key.leftArrow)  setConfirmSel(0);
      if (key.rightArrow) setConfirmSel(1);
      if (key.return) {
        if (confirmSel === 1) { setPhase('select'); return; }
        void runDrop();
      }
    },
    { isActive: phase === 'confirm' },
  );

  // ── done / error ──────────────────────────────────────────────────────────

  useInput(
    (_char, key) => {
      if (key.escape || key.return) {
        setDropPsqlOk(null);
        setDropFsOk(null);
        setDropPsqlErr('');
        setDropFsErr('');
        loadEntries();
        setPhase('select');
      }
    },
    { isActive: phase === 'done' || phase === 'error' },
  );

  // ── runner ────────────────────────────────────────────────────────────────

  const runDrop = useCallback(async () => {
    if (!currentEntry) return;
    setPhase('running');
    setDropPsqlOk(null);
    setDropFsOk(null);
    setDropPsqlErr('');
    setDropFsErr('');

    const psqlResult = await dropDatabase(currentEntry.dbName);
    setDropPsqlOk(psqlResult.ok);
    setDropPsqlErr(psqlResult.error ?? '');

    const fsResult = await removeFilestoreEntry(currentEntry.filestorePath);
    setDropFsOk(fsResult.ok);
    setDropFsErr(fsResult.error ?? '');

    setPhase(psqlResult.ok && fsResult.ok ? 'done' : 'error');
  }, [currentEntry]);

  // ── render ────────────────────────────────────────────────────────────────

  const entry = currentEntry;

  return (
    <Box flexDirection="row" flexGrow={1}>
      <LeftPanel width={leftWidth} primaryColor={primaryColor} textColor={textColor} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={secondaryColor} bold>Désinstaller une base</Text>

        {/* select */}
        {phase === 'select' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            {loading ? (
              <Text color={textColor} dimColor>Chargement…</Text>
            ) : entries.length === 0 ? (
              <>
                <Text color="yellow">Aucune base trouvée dans les filestores.</Text>
                <Text color={textColor} dimColor>Échap retour</Text>
              </>
            ) : (
              <>
                <Text color={textColor} dimColor>Sélectionnez une base à supprimer :</Text>
                <Box flexDirection="column" gap={0}>
                  {entries.map((e, i) => {
                    const isSel = i === selected;
                    return (
                      <Box key={`${e.versionBranch}/${e.dbName}`} flexDirection="row">
                        <Text
                          color={isSel ? 'black' : 'white'}
                          backgroundColor={isSel ? cursorColor : undefined}
                          bold={isSel}
                        >
                          {` ${isSel ? '▶' : ' '} ${e.dbName}`}
                        </Text>
                        <Text
                          color={isSel ? 'black' : textColor}
                          backgroundColor={isSel ? cursorColor : undefined}
                          dimColor={!isSel}
                        >
                          {`  [${e.versionBranch}]`}
                        </Text>
                      </Box>
                    );
                  })}
                </Box>
                <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour</Text>
              </>
            )}
          </Box>
        )}

        {/* confirm */}
        {phase === 'confirm' && entry && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="red" bold>Confirmer la suppression</Text>
            <Box flexDirection="column" gap={0} marginTop={1}>
              <Box flexDirection="row" gap={1}>
                <Text color={textColor} dimColor>Base psql :</Text>
                <Text color="white" bold>{entry.dbName}</Text>
              </Box>
              <Box flexDirection="row" gap={1}>
                <Text color={textColor} dimColor>Filestore :</Text>
                <Text color="white">{entry.filestorePath}</Text>
              </Box>
              <Box flexDirection="row" gap={1}>
                <Text color={textColor} dimColor>Version   :</Text>
                <Text color="white">{entry.versionBranch}</Text>
              </Box>
            </Box>
            <Box flexDirection="row" gap={2} marginTop={1}>
              <Text
                color={confirmSel === 0 ? 'black' : 'red'}
                backgroundColor={confirmSel === 0 ? 'red' : undefined}
                bold={confirmSel === 0}
              >
                {' Supprimer '}
              </Text>
              <Text
                color={confirmSel === 1 ? 'black' : textColor}
                backgroundColor={confirmSel === 1 ? cursorColor : undefined}
                bold={confirmSel === 1}
              >
                {' Annuler '}
              </Text>
            </Box>
            <Text color={textColor} dimColor>◀▶ choisir  ·  ↵ confirmer  ·  Échap annuler</Text>
          </Box>
        )}

        {/* running */}
        {phase === 'running' && entry && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color={textColor}>
              {'Suppression de '}
              <Text color={primaryColor} bold>{entry.dbName}</Text>
              {'…'}
            </Text>
            <Box flexDirection="column" gap={0} marginTop={1}>
              <Box flexDirection="row" gap={1}>
                <Text color={dropPsqlOk === null ? 'yellow' : dropPsqlOk ? 'green' : 'red'}>
                  {dropPsqlOk === null ? '⟳' : dropPsqlOk ? '✓' : '✗'}
                </Text>
                <Text color="white">Suppression base psql</Text>
              </Box>
              <Box flexDirection="row" gap={1}>
                <Text color={dropFsOk === null ? 'yellow' : dropFsOk ? 'green' : 'red'}>
                  {dropFsOk === null ? '⟳' : dropFsOk ? '✓' : '✗'}
                </Text>
                <Text color="white">Suppression filestore</Text>
              </Box>
            </Box>
          </Box>
        )}

        {/* done */}
        {phase === 'done' && entry && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="green">
              {'✓ '}
              <Text bold>{entry.dbName}</Text>
              {' supprimée avec succès.'}
            </Text>
            <Text color={textColor} dimColor>↵/Échap retour</Text>
          </Box>
        )}

        {/* error */}
        {phase === 'error' && entry && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="red" bold>Erreurs lors de la suppression</Text>
            <Box flexDirection="column" gap={0} marginTop={1}>
              <Box flexDirection="row" gap={1}>
                <Text color={dropPsqlOk ? 'green' : 'red'}>{dropPsqlOk ? '✓' : '✗'}</Text>
                <Text color="white">Base psql</Text>
                {!dropPsqlOk && dropPsqlErr ? (
                  <Text color="red" dimColor>{dropPsqlErr}</Text>
                ) : null}
              </Box>
              <Box flexDirection="row" gap={1}>
                <Text color={dropFsOk ? 'green' : 'red'}>{dropFsOk ? '✓' : '✗'}</Text>
                <Text color="white">Filestore</Text>
                {!dropFsOk && dropFsErr ? (
                  <Text color="red" dimColor>{dropFsErr}</Text>
                ) : null}
              </Box>
            </Box>
            <Text color={textColor} dimColor>↵/Échap retour</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
