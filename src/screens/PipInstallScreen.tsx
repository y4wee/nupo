import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { join } from 'path';
import {
  NupoConfig,
  OdooVersion,
  getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor, sortedOdooVersions,
} from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { pipInstallPackages, pipUninstallPackages, getInstalledPackages, normalizePkg } from '../services/python.js';
import { scanManifestDependencies } from '../services/manifest.js';
import { copyToClipboard, extractCopyableCommand } from '../services/system.js';

interface PipInstallScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
}

type Phase =
  | 'version_select'
  | 'mode_select'
  | 'global_scanning'
  | 'global_confirm'
  | 'specific_input'
  | 'uninstall_input'
  | 'running'
  | 'done'
  | 'error';

type ModeId = 'global' | 'specific' | 'uninstall';

const MODES: { id: ModeId; label: string; description: string }[] = [
  {
    id: 'global',
    label: 'Installation globale',
    description: 'Analyse les manifests des modules custom et installe les dépendances Python manquantes.',
  },
  {
    id: 'specific',
    label: 'Installation spécifique',
    description: 'Installe une librairie pip en saisissant son nom.',
  },
  {
    id: 'uninstall',
    label: 'Désinstallation',
    description: 'Désinstalle une librairie pip en saisissant son nom.',
  },
];

export function PipInstallScreen({ config, leftWidth, onBack }: PipInstallScreenProps) {
  const primaryColor   = getPrimaryColor(config);
  const secondaryColor = getSecondaryColor(config);
  const textColor      = getTextColor(config);
  const cursorColor    = getCursorColor(config);

  const versions = sortedOdooVersions(Object.values(config.odoo_versions ?? {}));

  const [phase,       setPhase]       = useState<Phase>('version_select');
  const [versionSel,  setVersionSel]  = useState(0);
  const [modeSel,     setModeSel]     = useState(0);
  const [selectedVer, setSelectedVer] = useState<OdooVersion | null>(null);
  const [scanStatus,  setScanStatus]  = useState('');
  const [toInstall,   setToInstall]   = useState<string[]>([]);
  const [alreadyInst, setAlreadyInst] = useState<string[]>([]);
  const [confirmSel,  setConfirmSel]  = useState(0); // 0 = Installer, 1 = Annuler
  const [libInput,    setLibInput]    = useState('');
  const [inputError,  setInputError]  = useState<string | null>(null);
  const [pipOutput,   setPipOutput]   = useState('');
  const [errorMsg,    setErrorMsg]    = useState('');
  const [retrySel,    setRetrySel]    = useState(0); // 0 = Relancer, 1 = Retour
  const [copied,      setCopied]      = useState(false);
  const pendingPackagesRef = useRef<string[]>([]);
  const pipPathRef         = useRef('');
  const pythonBinRef       = useRef<string | undefined>(undefined);
  const actionRef          = useRef<'install' | 'uninstall'>('install');

  // ── Version select ────────────────────────────────────────────────────────

  useInput(
    (_char, key) => {
      if (key.escape) { onBack(); return; }
      if (key.upArrow)   setVersionSel(p => Math.max(0, p - 1));
      if (key.downArrow) setVersionSel(p => Math.min(versions.length - 1, p + 1));
      if (key.return && versions[versionSel]) {
        const ver = versions[versionSel]!;
        setSelectedVer(ver);
        pipPathRef.current = join(ver.path, '.venv', 'bin', 'pip');
        // Derive "python3.8" from stored pythonVersion "3.8.20" for error hints
        const mm = ver.pythonVersion?.match(/^(\d+\.\d+)/)?.[1];
        pythonBinRef.current = mm ? `python${mm}` : undefined;
        setPhase('mode_select');
      }
    },
    { isActive: phase === 'version_select' },
  );

  // ── Mode select ───────────────────────────────────────────────────────────

  useInput(
    (_char, key) => {
      if (key.escape) { setPhase('version_select'); return; }
      if (key.upArrow)   setModeSel(p => Math.max(0, p - 1));
      if (key.downArrow) setModeSel(p => Math.min(MODES.length - 1, p + 1));
      if (key.return) {
        const mode = MODES[modeSel]?.id;
        if (mode === 'global') {
          setPhase('global_scanning');
          void runGlobalScan();
        } else if (mode === 'specific') {
          setLibInput('');
          setInputError(null);
          setPhase('specific_input');
        } else if (mode === 'uninstall') {
          setLibInput('');
          setInputError(null);
          setPhase('uninstall_input');
        }
      }
    },
    { isActive: phase === 'mode_select' },
  );

  // ── Specific / Uninstall input escape ────────────────────────────────────

  useInput(
    (_char, key) => { if (key.escape) { setLibInput(''); setInputError(null); setPhase('mode_select'); } },
    { isActive: phase === 'specific_input' || phase === 'uninstall_input' },
  );

  // ── Global confirm ────────────────────────────────────────────────────────

  useInput(
    (_char, key) => {
      if (key.escape) { setPhase('mode_select'); return; }
      if (key.leftArrow)  setConfirmSel(0);
      if (key.rightArrow) setConfirmSel(1);
      if (key.return) {
        if (confirmSel === 1) { setPhase('mode_select'); return; }
        actionRef.current = 'install';
        pendingPackagesRef.current = toInstall;
        setPhase('running');
        void runInstall(toInstall);
      }
    },
    { isActive: phase === 'global_confirm' && toInstall.length > 0 },
  );

  useInput(
    (_char, key) => { if (key.escape) setPhase('mode_select'); },
    { isActive: phase === 'global_confirm' && toInstall.length === 0 },
  );

  // ── Error recovery ────────────────────────────────────────────────────────

  useInput(
    (char, key) => {
      if (key.escape) { onBack(); return; }
      if (key.leftArrow)  setRetrySel(0);
      if (key.rightArrow) setRetrySel(1);
      if (key.return) {
        if (retrySel === 1) { onBack(); return; }
        setPhase('running');
        setPipOutput('');
        if (actionRef.current === 'uninstall') {
          void runUninstall(pendingPackagesRef.current);
        } else {
          void runInstall(pendingPackagesRef.current);
        }
      }
      if (char === 'c') {
        const cmd = extractCopyableCommand(errorMsg);
        if (cmd) {
          copyToClipboard(cmd);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      }
    },
    { isActive: phase === 'error' },
  );

  // ── Done ──────────────────────────────────────────────────────────────────

  useInput(
    (_char, key) => { if (key.escape) onBack(); },
    { isActive: phase === 'done' },
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  const runGlobalScan = useCallback(async () => {
    if (!selectedVer) return;
    setScanStatus('Analyse des manifests…');

    const { deps, manifestCount } = await scanManifestDependencies(join(selectedVer.path, 'custom'));
    if (deps.length === 0) {
      setScanStatus(`${manifestCount} manifest(s) analysé(s) — aucune dépendance externe trouvée.`);
      setToInstall([]);
      setAlreadyInst([]);
      setPhase('global_confirm');
      return;
    }

    setScanStatus(`${manifestCount} manifest(s) · ${deps.length} dépendance(s) — Vérification des packages installés…`);
    const installed = await getInstalledPackages(pipPathRef.current);
    setToInstall(deps.filter(d => !installed.has(normalizePkg(d))));
    setAlreadyInst(deps.filter(d =>  installed.has(normalizePkg(d))));
    setPhase('global_confirm');
  }, [selectedVer]);

  const runInstall = useCallback(async (packages: string[]) => {
    setPipOutput('');
    const r = await pipInstallPackages(pipPathRef.current, packages, line => setPipOutput(line), pythonBinRef.current);
    if (r.ok) { setPhase('done'); }
    else { setErrorMsg(r.error ?? 'Erreur inconnue'); setPhase('error'); }
  }, []);

  const runUninstall = useCallback(async (packages: string[]) => {
    setPipOutput('');
    const r = await pipUninstallPackages(pipPathRef.current, packages, line => setPipOutput(line));
    if (r.ok) { setPhase('done'); }
    else { setErrorMsg(r.error ?? 'Erreur inconnue'); setPhase('error'); }
  }, []);

  const handleSpecificSubmit = (value: string) => {
    const lib = value.trim();
    if (!lib) { setInputError('Le nom de la librairie ne peut pas être vide.'); return; }
    actionRef.current = 'install';
    pendingPackagesRef.current = [lib];
    setPhase('running');
    void runInstall([lib]);
  };

  const handleUninstallSubmit = (value: string) => {
    const lib = value.trim();
    if (!lib) { setInputError('Le nom de la librairie ne peut pas être vide.'); return; }
    actionRef.current = 'uninstall';
    pendingPackagesRef.current = [lib];
    setPhase('running');
    void runUninstall([lib]);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const isUninstall = actionRef.current === 'uninstall';

  return (
    <Box flexDirection="row" flexGrow={1}>
      <LeftPanel width={leftWidth} primaryColor={primaryColor} textColor={textColor} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={secondaryColor} bold>Gérer les librairies Python</Text>

        {/* ── No versions installed ── */}
        {versions.length === 0 && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="yellow">Aucune version Odoo installée.</Text>
            <Text color={textColor} dimColor>{'Échap retour'}</Text>
          </Box>
        )}

        {/* ── Version select ── */}
        {phase === 'version_select' && versions.length > 0 && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="white">Sélectionner une version Odoo :</Text>
            <Box flexDirection="column" gap={0}>
              {versions.map((v, i) => {
                const isSel = i === versionSel;
                return (
                  <Text
                    key={v.branch}
                    color={isSel ? 'black' : 'white'}
                    backgroundColor={isSel ? cursorColor : undefined}
                    bold={isSel}
                  >
                    {` ${isSel ? '▶' : ' '} ${v.branch}  `}
                    <Text color={isSel ? 'black' : 'gray'} dimColor={!isSel}>{v.path}</Text>
                  </Text>
                );
              })}
            </Box>
            <Text color={textColor} dimColor>{'↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour'}</Text>
          </Box>
        )}

        {/* ── Mode select ── */}
        {phase === 'mode_select' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color={textColor}>
              {'Version : '}
              <Text color={primaryColor} bold>{selectedVer?.branch}</Text>
            </Text>
            <Box flexDirection="column" gap={0}>
              {MODES.map((m, i) => {
                const isSel = i === modeSel;
                return (
                  <Box key={m.id} flexDirection="column" gap={0} marginBottom={1}>
                    <Text
                      color={isSel ? 'black' : 'white'}
                      backgroundColor={isSel ? cursorColor : undefined}
                      bold={isSel}
                    >
                      {` ${isSel ? '▶' : ' '} ${m.label}`}
                    </Text>
                    <Text color={textColor} dimColor>{`     ${m.description}`}</Text>
                  </Box>
                );
              })}
            </Box>
            <Text color={textColor} dimColor>{'↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour'}</Text>
          </Box>
        )}

        {/* ── Global scanning ── */}
        {phase === 'global_scanning' && (
          <Box marginTop={1}>
            <Text color={textColor} dimColor>{'⟳ '}</Text>
            <Text color={textColor}>{scanStatus || 'Analyse en cours…'}</Text>
          </Box>
        )}

        {/* ── Global confirm ── */}
        {phase === 'global_confirm' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color={textColor} dimColor>{scanStatus}</Text>

            {toInstall.length === 0 ? (
              <>
                <Text color="green">{'✓ Toutes les dépendances sont déjà installées.'}</Text>
                <Text color={textColor} dimColor>{'Échap retour'}</Text>
              </>
            ) : (
              <>
                <Box flexDirection="column" gap={0}>
                  <Text color="white" bold>{`Dépendances à installer (${toInstall.length}) :`}</Text>
                  {toInstall.map(p => (
                    <Text key={p} color={textColor}>{`  • ${p}`}</Text>
                  ))}
                </Box>
                {alreadyInst.length > 0 && (
                  <Box flexDirection="column" gap={0}>
                    <Text color={textColor} dimColor bold>{`Déjà installées (${alreadyInst.length}) :`}</Text>
                    <Text color={textColor} dimColor>{`  ${alreadyInst.join(', ')}`}</Text>
                  </Box>
                )}
                <Box flexDirection="row" gap={2} marginTop={1}>
                  <Text
                    color={confirmSel === 0 ? 'black' : 'white'}
                    backgroundColor={confirmSel === 0 ? cursorColor : undefined}
                    bold={confirmSel === 0}
                  >
                    {' Installer '}
                  </Text>
                  <Text
                    color={confirmSel === 1 ? 'black' : 'white'}
                    backgroundColor={confirmSel === 1 ? 'gray' : undefined}
                    bold={confirmSel === 1}
                  >
                    {' Annuler '}
                  </Text>
                </Box>
                <Text color={textColor} dimColor>{'◀▶ choisir  ·  ↵ confirmer  ·  Échap retour'}</Text>
              </>
            )}
          </Box>
        )}

        {/* ── Specific input ── */}
        {phase === 'specific_input' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color={textColor}>
              {'Version : '}
              <Text color={primaryColor} bold>{selectedVer?.branch}</Text>
            </Text>
            <Text color="white">Librairie à installer :</Text>
            <Box>
              <Text color={textColor} dimColor>{'› '}</Text>
              <TextInput
                value={libInput}
                onChange={v => { setLibInput(v); setInputError(null); }}
                onSubmit={handleSpecificSubmit}
                placeholder="requests"
              />
            </Box>
            {inputError && <Text color="red">{inputError}</Text>}
            <Text color={textColor} dimColor>{'↵ installer  ·  Échap retour'}</Text>
          </Box>
        )}

        {/* ── Uninstall input ── */}
        {phase === 'uninstall_input' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color={textColor}>
              {'Version : '}
              <Text color={primaryColor} bold>{selectedVer?.branch}</Text>
            </Text>
            <Text color="white">Librairie à désinstaller :</Text>
            <Box>
              <Text color={textColor} dimColor>{'› '}</Text>
              <TextInput
                value={libInput}
                onChange={v => { setLibInput(v); setInputError(null); }}
                onSubmit={handleUninstallSubmit}
                placeholder="requests"
              />
            </Box>
            {inputError && <Text color="red">{inputError}</Text>}
            <Text color={textColor} dimColor>{'↵ désinstaller  ·  Échap retour'}</Text>
          </Box>
        )}

        {/* ── Running ── */}
        {phase === 'running' && (
          <Box flexDirection="column" gap={0} marginTop={1}>
            <Text color={textColor}>
              {isUninstall ? 'Désinstallation de ' : 'Installation de '}
              <Text color={primaryColor} bold>{pendingPackagesRef.current.join(', ')}</Text>
              {'…'}
            </Text>
            {pipOutput !== '' && (
              <Text color={textColor} dimColor>{pipOutput}</Text>
            )}
          </Box>
        )}

        {/* ── Done ── */}
        {phase === 'done' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="green">
              {'✓ '}
              <Text bold>{pendingPackagesRef.current.join(', ')}</Text>
              {isUninstall ? ' désinstallé(s) avec succès.' : ' installé(s) avec succès.'}
            </Text>
            <Text color={textColor} dimColor>{'Échap retour'}</Text>
          </Box>
        )}

        {/* ── Error ── */}
        {phase === 'error' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="red">{`✗ ${errorMsg}`}</Text>
            {extractCopyableCommand(errorMsg) && (
              <Text color={copied ? 'green' : textColor} dimColor={!copied}>
                {copied ? '  ✓ Copié !' : '  c → copier commande'}
              </Text>
            )}
            <Box flexDirection="row" gap={2}>
              <Text
                color={retrySel === 0 ? 'black' : 'white'}
                backgroundColor={retrySel === 0 ? cursorColor : undefined}
                bold={retrySel === 0}
              >
                {' ↺ Relancer '}
              </Text>
              <Text
                color={retrySel === 1 ? 'black' : 'white'}
                backgroundColor={retrySel === 1 ? 'gray' : undefined}
                bold={retrySel === 1}
              >
                {' ← Retour '}
              </Text>
            </Box>
            <Text color={textColor} dimColor>{'◀▶ choisir  ·  ↵ confirmer  ·  Échap retour'}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
