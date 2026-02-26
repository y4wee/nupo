import React, { useState, useEffect, useCallback, useRef, useReducer } from 'react';
import { Box, Text, useInput } from 'ink';
import { stat } from 'fs/promises';
import { join } from 'path';
import { NupoConfig, OdooVersion, UpgradeStep, StepStatus, getPrimaryColor, getSecondaryColor, getTextColor } from '../types/index.js';
import {
  GitProgress,
  getLocalCommit, getRemoteCommit, updateRepo,
  ODOO_COMMUNITY_URL,
} from '../services/git.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { StepsPanel } from '../components/StepsPanel.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import { ProgressBar } from '../components/ProgressBar.js';

interface UpgradeVersionScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
}

interface VersionStatus {
  checking: boolean;
  upToDate: boolean | null; // null = erreur / inconnu
}

type Phase = 'list' | 'confirm' | 'upgrading' | 'done';

type StepAction =
  | { type: 'SET_STATUS'; id: string; status: StepStatus; errorMessage?: string }
  | { type: 'RESET'; steps: UpgradeStep[] };

function stepReducer(state: UpgradeStep[], action: StepAction): UpgradeStep[] {
  if (action.type === 'RESET') return action.steps;
  return state.map(s =>
    s.id === action.id ? { ...s, status: action.status, errorMessage: action.errorMessage } : s,
  );
}

async function dirExists(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

export function UpgradeVersionScreen({ config, leftWidth, onBack }: UpgradeVersionScreenProps) {
  const versions = Object.values(config.odoo_versions);
  const textColor = getTextColor(config);

  const [phase, setPhase] = useState<Phase>('list');
  const [selected, setSelected] = useState(0);
  const [statusMap, setStatusMap] = useState<Record<string, VersionStatus>>({});
  const [confirmAction, setConfirmAction] = useState<0 | 1>(0);
  const [steps, dispatch] = useReducer(stepReducer, []);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [errorAction, setErrorAction] = useState<0 | 1>(0);
  const [fetchProgress, setFetchProgress] = useState<GitProgress | null>(null);

  const selectedVersionRef = useRef<OdooVersion | null>(null);
  const stepsRef = useRef(steps);
  const dispatchRef = useRef(dispatch);
  stepsRef.current = steps;
  dispatchRef.current = dispatch;

  // ── Vérification du statut de chaque version au montage ──────────────────

  useEffect(() => {
    if (versions.length === 0) return;
    const initial: Record<string, VersionStatus> = {};
    for (const v of versions) initial[v.branch] = { checking: true, upToDate: null };
    setStatusMap(initial);

    for (const v of versions) {
      const communityPath = join(v.path, 'community');
      void Promise.all([
        getLocalCommit(communityPath),
        getRemoteCommit(ODOO_COMMUNITY_URL, v.branch),
      ]).then(([local, remote]) => {
        const upToDate = local !== null && remote !== null ? local === remote : null;
        setStatusMap(prev => ({ ...prev, [v.branch]: { checking: false, upToDate } }));
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Input : liste ─────────────────────────────────────────────────────────

  useInput(
    (_char, key) => {
      if (key.escape) { onBack(); return; }
      if (key.upArrow)   setSelected(p => (p - 1 + versions.length) % versions.length);
      if (key.downArrow) setSelected(p => (p + 1) % versions.length);
      if (key.return && versions[selected]) {
        selectedVersionRef.current = versions[selected]!;
        setConfirmAction(0);
        setPhase('confirm');
      }
    },
    { isActive: phase === 'list' && versions.length > 0 },
  );

  useInput(
    (_char, key) => { if (key.escape) onBack(); },
    { isActive: phase === 'list' && versions.length === 0 },
  );

  // ── Input : confirmation ──────────────────────────────────────────────────

  useInput(
    (_char, key) => {
      if (key.escape) { setPhase('list'); return; }
      if (key.leftArrow)  setConfirmAction(0);
      if (key.rightArrow) setConfirmAction(1);
      if (key.return) {
        if (confirmAction === 1) { setPhase('list'); return; }
        void startUpgrade();
      }
    },
    { isActive: phase === 'confirm' },
  );

  // ── Input : erreur / retry ────────────────────────────────────────────────

  const errorStep = steps.find(s => s.status === 'error');

  useInput(
    (_char, key) => {
      if (key.escape) { setPhase('list'); return; }
      if (key.leftArrow)  setErrorAction(0);
      if (key.rightArrow) setErrorAction(1);
      if (key.return) {
        if (errorAction === 0) {
          const step = stepsRef.current[currentStepIdx];
          if (step) {
            dispatchRef.current({ type: 'SET_STATUS', id: step.id, status: 'pending', errorMessage: undefined });
            setRetryCount(c => c + 1);
          }
        } else {
          setPhase('list');
        }
      }
    },
    { isActive: phase === 'upgrading' && !!errorStep },
  );

  // ── Input : terminé ───────────────────────────────────────────────────────

  useInput(
    (_char, key) => { if (key.escape) onBack(); },
    { isActive: phase === 'done' },
  );

  // ── Démarrage de la mise à jour ───────────────────────────────────────────

  const startUpgrade = useCallback(async () => {
    const version = selectedVersionRef.current;
    if (!version) return;

    const enterprisePath = join(version.path, 'enterprise');
    const hasEnterprise = await dirExists(enterprisePath);

    const initialSteps: UpgradeStep[] = [
      { id: 'update_community', label: 'Mise à jour community', status: 'pending' },
      ...(hasEnterprise
        ? [{ id: 'update_enterprise' as const, label: 'Mise à jour enterprise', status: 'pending' as StepStatus }]
        : []),
    ];

    dispatchRef.current({ type: 'RESET', steps: initialSteps });
    setCurrentStepIdx(0);
    setRetryCount(0);
    setErrorAction(0);
    setPhase('upgrading');
  }, []);

  // ── Exécution des étapes ──────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'upgrading') return;
    const version = selectedVersionRef.current;
    if (!version) return;
    const step = stepsRef.current[currentStepIdx];
    if (!step) return;

    void (async () => {
      dispatchRef.current({ type: 'SET_STATUS', id: step.id, status: 'running', errorMessage: undefined });
      setFetchProgress(null);

      const repoPath = step.id === 'update_community'
        ? join(version.path, 'community')
        : join(version.path, 'enterprise');

      const r = await updateRepo(repoPath, version.branch, progress => {
        setFetchProgress(progress);
      });
      setFetchProgress(null);

      if (r.ok) {
        dispatchRef.current({ type: 'SET_STATUS', id: step.id, status: 'success', errorMessage: repoPath });
        const nextIdx = currentStepIdx + 1;
        if (nextIdx < stepsRef.current.length) {
          setCurrentStepIdx(nextIdx);
        } else {
          setPhase('done');
          // Re-vérifier le statut de la version mise à jour
          const communityPath = join(version.path, 'community');
          void Promise.all([
            getLocalCommit(communityPath),
            getRemoteCommit(ODOO_COMMUNITY_URL, version.branch),
          ]).then(([local, remote]) => {
            const upToDate = local !== null && remote !== null ? local === remote : null;
            setStatusMap(prev => ({ ...prev, [version.branch]: { checking: false, upToDate } }));
          });
        }
      } else {
        dispatchRef.current({ type: 'SET_STATUS', id: step.id, status: 'error', errorMessage: r.error });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentStepIdx, retryCount]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="row" flexGrow={1}>
        <LeftPanel width={leftWidth} primaryColor={getPrimaryColor(config)} textColor={textColor} />

        <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
          <Text color={getSecondaryColor(config)} bold>Mise à niveau</Text>

          {/* Aucune version installée */}
          {versions.length === 0 && (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text color={textColor}>Aucune version Odoo installée.</Text>
              <Text color={textColor} dimColor>Échap retour</Text>
            </Box>
          )}

          {/* Liste des versions */}
          {phase === 'list' && versions.length > 0 && (
            <Box flexDirection="column" gap={0} marginTop={1}>
              {versions.map((v, i) => {
                const status = statusMap[v.branch];
                const isSelected = i === selected;
                let icon = '⟳';
                let iconColor = 'gray';
                if (status && !status.checking) {
                  if (status.upToDate === true)       { icon = '✓'; iconColor = 'green'; }
                  else if (status.upToDate === false) { icon = '!'; iconColor = 'yellow'; }
                  else                                { icon = '?'; iconColor = 'red'; }
                }
                return (
                  <Box key={v.branch} flexDirection="row" gap={1} alignItems="center">
                    <Text
                      color={isSelected ? 'black' : 'white'}
                      backgroundColor={isSelected ? 'cyan' : undefined}
                      bold={isSelected}
                    >
                      {` ${isSelected ? '▶' : ' '} ${v.branch}  `}
                      <Text color={isSelected ? 'black' : 'gray'} dimColor={!isSelected}>
                        {v.path}
                      </Text>
                    </Text>
                    <Text color={iconColor}>{icon}</Text>
                  </Box>
                );
              })}
              <Box marginTop={1}>
                <Text color={textColor} dimColor>{'↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour'}</Text>
              </Box>
            </Box>
          )}

          {/* Confirmation */}
          {phase === 'confirm' && (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text color="white">
                {'Mettre à jour '}
                <Text color={getPrimaryColor(config)} bold>{selectedVersionRef.current?.branch}</Text>
                {' ?'}
              </Text>
              <Box flexDirection="row" gap={2}>
                <Text
                  color={confirmAction === 0 ? 'black' : 'white'}
                  backgroundColor={confirmAction === 0 ? 'cyan' : undefined}
                  bold={confirmAction === 0}
                >
                  {' ✓ Oui '}
                </Text>
                <Text
                  color={confirmAction === 1 ? 'black' : 'white'}
                  backgroundColor={confirmAction === 1 ? 'gray' : undefined}
                  bold={confirmAction === 1}
                >
                  {' ✗ Non '}
                </Text>
              </Box>
              <Text color={textColor} dimColor>{'◀▶ choisir  ·  ↵ confirmer  ·  Échap retour'}</Text>
            </Box>
          )}

          {/* Mise à jour en cours */}
          {phase === 'upgrading' && !errorStep && (
            <Box flexDirection="column" marginTop={1} gap={0}>
              <Text color={textColor}>
                {'Mise à jour de '}
                <Text color={getPrimaryColor(config)} bold>{selectedVersionRef.current?.branch}</Text>
                {'…'}
              </Text>
              {fetchProgress && (
                <Box flexDirection="column" marginTop={1} gap={0}>
                  <ProgressBar percent={fetchProgress.percent} textColor={textColor} />
                  <Text color={textColor} dimColor>
                    {fetchProgress.phase === 'receiving' ? 'Receiving objects' : 'Resolving deltas '}
                    {fetchProgress.speed ? `  ${fetchProgress.speed}` : ''}
                  </Text>
                </Box>
              )}
              {!fetchProgress && phase === 'upgrading' && (
                <Text color={textColor} dimColor>⟳ Connexion au dépôt…</Text>
              )}
            </Box>
          )}

          {/* Récupération erreur */}
          {phase === 'upgrading' && errorStep && (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Box flexDirection="row" gap={2}>
                <Text
                  color={errorAction === 0 ? 'black' : 'white'}
                  backgroundColor={errorAction === 0 ? 'cyan' : undefined}
                  bold={errorAction === 0}
                >
                  {' ↺ Relancer '}
                </Text>
                <Text
                  color={errorAction === 1 ? 'black' : 'white'}
                  backgroundColor={errorAction === 1 ? 'gray' : undefined}
                  bold={errorAction === 1}
                >
                  {' ← Retour '}
                </Text>
              </Box>
              <Text color={textColor} dimColor>{'◀▶ choisir  ·  ↵ confirmer  ·  Échap retour'}</Text>
            </Box>
          )}

          {/* Terminé */}
          {phase === 'done' && (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text color="green">
                {'✓ '}
                <Text bold>{selectedVersionRef.current?.branch}</Text>
                {' mis à jour avec succès.'}
              </Text>
              <Text color={textColor} dimColor>Échap retour</Text>
            </Box>
          )}
        </Box>
      </Box>

      {phase === 'upgrading' && <StepsPanel steps={steps} textColor={textColor} />}
      {phase === 'upgrading' && <ErrorPanel steps={steps} />}
    </Box>
  );
}
