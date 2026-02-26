import React, { useReducer, useEffect, useState, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { mkdir, stat } from 'fs/promises';
import { join } from 'path';
import {
  InstallStep, InstallStepId, StepStatus, NupoConfig, PendingInstall, getPrimaryColor,
} from '../types/index.js';
import {
  GitProgress,
  checkBranch, cloneRepo,
  ODOO_COMMUNITY_URL, ODOO_ENTERPRISE_URL,
} from '../services/git.js';
import { createVenv, installRequirements } from '../services/python.js';
import { readConfig, writeConfig } from '../services/config.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { StepsPanel } from '../components/StepsPanel.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import { ProgressBar } from '../components/ProgressBar.js';

interface InstallVersionScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onComplete: () => void;
  onBack: () => void;
}

const STEP_DEFS: { id: InstallStepId; label: string }[] = [
  { id: 'branch_input',         label: 'Saisie de la version' },
  { id: 'check_community',      label: 'Vérification branche community' },
  { id: 'check_enterprise',     label: 'Vérification branche enterprise' },
  { id: 'create_dir',           label: 'Création du dossier' },
  { id: 'clone_community',      label: 'Téléchargement Odoo community' },
  { id: 'clone_enterprise',     label: 'Téléchargement Odoo enterprise' },
  { id: 'create_venv',          label: 'Création de l\'environnement virtuel Python' },
  { id: 'install_requirements', label: 'Installation des dépendances Python' },
  { id: 'create_extras',        label: 'Création dossiers custom et config' },
];

type StepAction =
  | { type: 'SET_STATUS'; id: InstallStepId; status: StepStatus; errorMessage?: string }
  | { type: 'RESET'; steps: InstallStep[] };

function reducer(state: InstallStep[], action: StepAction): InstallStep[] {
  if (action.type === 'RESET') return action.steps;
  return state.map(s =>
    s.id === action.id ? { ...s, status: action.status, errorMessage: action.errorMessage } : s,
  );
}

function buildInitialSteps(): InstallStep[] {
  return STEP_DEFS.map((def, i) => ({
    ...def,
    status: (i === 0 ? 'running' : 'pending') as StepStatus,
  }));
}

/** Builds steps for a resume: steps up to lastCompletedStep are success, rest pending. */
function buildResumedSteps(lastCompletedStep: InstallStepId | null): InstallStep[] {
  const lastIdx = lastCompletedStep
    ? STEP_DEFS.findIndex(s => s.id === lastCompletedStep)
    : -1;
  return STEP_DEFS.map((def, i) => ({
    ...def,
    status: (i <= lastIdx ? 'success' : 'pending') as StepStatus,
  }));
}

async function dirExists(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}


const PHASE_LABEL: Record<GitProgress['phase'], string> = {
  receiving: 'Receiving objects',
  resolving: 'Resolving deltas ',
};

// ── Screen ──────────────────────────────────────────────────────────────────

export function InstallVersionScreen({
  config, leftWidth, onComplete, onBack,
}: InstallVersionScreenProps) {
  const [steps, dispatch] = useReducer(reducer, buildInitialSteps());
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [branchInput, setBranchInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [branchName, setBranchName] = useState('');
  const [versionPath, setVersionPath] = useState('');
  const [done, setDone] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<GitProgress | null>(null);
  const [pipOutput, setPipOutput] = useState<string>('');
  const [retryCount, setRetryCount] = useState(0);
  const [errorAction, setErrorAction] = useState<0 | 1>(0); // 0 = Relancer, 1 = Retour
  const [focus, setFocus] = useState<'input' | 'pending' | 'installed'>('input');
  const [pendingSelected,   setPendingSelected]   = useState(0);
  const [installedSelected, setInstalledSelected] = useState(0);

  // Refs for use inside async callbacks
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const branchNameRef = useRef('');
  const versionPathRef = useRef('');

  const pendingInstalls    = Object.values(config.pending_installs ?? {});
  const installedVersions  = Object.values(config.odoo_versions ?? {});

  // ── Handlers defined before useInput ──────────────────────────────────────

  const handleRetry = () => {
    const step = STEP_DEFS[currentStepIndex];
    if (!step) return;
    dispatch({ type: 'SET_STATUS', id: step.id, status: 'pending', errorMessage: undefined });
    setRetryCount(c => c + 1);
  };

  const handleReinstall = (version: { branch: string; path: string }) => {
    branchNameRef.current  = version.branch;
    versionPathRef.current = version.path;
    setBranchName(version.branch);
    setVersionPath(version.path);
    dispatch({ type: 'RESET', steps: buildResumedSteps('branch_input') });
    setCurrentStepIndex(1);
  };

  const handleResume = (pending: PendingInstall) => {
    branchNameRef.current = pending.branch;
    versionPathRef.current = pending.path;
    setBranchName(pending.branch);
    setVersionPath(pending.path);
    const resumedSteps = buildResumedSteps(pending.lastCompletedStep);
    dispatch({ type: 'RESET', steps: resumedSteps });
    const lastIdx = pending.lastCompletedStep
      ? STEP_DEFS.findIndex(s => s.id === pending.lastCompletedStep)
      : -1;
    setCurrentStepIndex(lastIdx + 1);
  };

  // ── Input hooks ────────────────────────────────────────────────────────────

  // Input field: Escape = back, ↓ = switch to pending or installed list
  useInput(
    (_char, key) => {
      if (key.escape) { onBack(); return; }
      if (key.downArrow) {
        if (pendingInstalls.length > 0) { setFocus('pending'); setPendingSelected(0); }
        else if (installedVersions.length > 0) { setFocus('installed'); setInstalledSelected(0); }
      }
    },
    { isActive: currentStepIndex === 0 && focus === 'input' },
  );

  // Pending list navigation
  useInput(
    (_char, key) => {
      if (key.escape || (key.upArrow && pendingSelected === 0)) {
        setFocus('input');
        return;
      }
      if (key.upArrow) setPendingSelected(p => p - 1);
      if (key.downArrow) {
        if (pendingSelected < pendingInstalls.length - 1) setPendingSelected(p => p + 1);
        else if (installedVersions.length > 0) { setFocus('installed'); setInstalledSelected(0); }
      }
      if (key.return && pendingInstalls[pendingSelected]) {
        handleResume(pendingInstalls[pendingSelected]!);
      }
    },
    { isActive: currentStepIndex === 0 && focus === 'pending' },
  );

  // Installed versions navigation
  useInput(
    (_char, key) => {
      if (key.escape || (key.upArrow && installedSelected === 0)) {
        if (pendingInstalls.length > 0) { setFocus('pending'); setPendingSelected(pendingInstalls.length - 1); }
        else setFocus('input');
        return;
      }
      if (key.upArrow)   setInstalledSelected(p => p - 1);
      if (key.downArrow) setInstalledSelected(p => Math.min(p + 1, installedVersions.length - 1));
      if (key.return && installedVersions[installedSelected]) {
        handleReinstall(installedVersions[installedSelected]!);
      }
    },
    { isActive: currentStepIndex === 0 && focus === 'installed' },
  );

  // Error recovery: Relancer / Retour
  useInput(
    (_char, key) => {
      if (key.leftArrow)  setErrorAction(0);
      if (key.rightArrow) setErrorAction(1);
      if (key.escape)     onBack();
      if (key.return)     errorAction === 0 ? handleRetry() : onBack();
    },
    { isActive: !!steps.find(s => s.status === 'error') && currentStepIndex > 0 },
  );

  // Done: wait for Escape before navigating back
  useInput(
    (_char, key) => { if (key.escape) onCompleteRef.current(); },
    { isActive: done },
  );

  // ── Save progress helper ───────────────────────────────────────────────────

  const saveProgress = useCallback(async (lastCompletedStep: InstallStepId) => {
    try {
      const current = await readConfig();
      await writeConfig({
        ...current,
        pending_installs: {
          ...(current.pending_installs ?? {}),
          [branchNameRef.current]: {
            branch: branchNameRef.current,
            path: versionPathRef.current,
            lastCompletedStep,
          },
        },
      });
    } catch { /* non-critical — installation continues regardless */ }
  }, []);

  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;

  // ── Branch input submit ────────────────────────────────────────────────────

  const handleBranchSubmit = async (value: string) => {
    const name = value.trim();
    if (!name) { setInputError('Le nom de la branche ne peut pas être vide.'); return; }
    if (config.odoo_versions[name]) {
      const existing = config.odoo_versions[name]!;
      if (await dirExists(existing.path)) {
        setInputError(
          `La version "${name}" est déjà installée dans ${existing.path}`,
        );
        return;
      }
      // Dossier supprimé manuellement → on nettoie la config et on réinstalle
      const current = await readConfig();
      const { [name]: _removed, ...restVersions } = current.odoo_versions;
      await writeConfig({ ...current, odoo_versions: restVersions });
    }
    const path = join(config.odoo_path_repo, name);
    branchNameRef.current = name;
    versionPathRef.current = path;
    setBranchName(name);
    setVersionPath(path);
    dispatch({ type: 'SET_STATUS', id: 'branch_input', status: 'success', errorMessage: name });
    void saveProgressRef.current('branch_input');
    setCurrentStepIndex(1);
  };

  // ── Auto steps ──────────────────────────────────────────────────────────

  const runCheckCommunity = useCallback(async () => {
    dispatchRef.current({ type: 'SET_STATUS', id: 'check_community', status: 'running' });
    const r = await checkBranch(ODOO_COMMUNITY_URL, branchNameRef.current);
    if (r.ok) {
      dispatchRef.current({ type: 'SET_STATUS', id: 'check_community', status: 'success' });
      void saveProgressRef.current('check_community');
      setCurrentStepIndex(2);
    } else {
      dispatchRef.current({ type: 'SET_STATUS', id: 'check_community', status: 'error', errorMessage: r.error });
    }
  }, []);

  const runCheckEnterprise = useCallback(async () => {
    dispatchRef.current({ type: 'SET_STATUS', id: 'check_enterprise', status: 'running' });
    const r = await checkBranch(ODOO_ENTERPRISE_URL, branchNameRef.current);
    if (r.ok) {
      dispatchRef.current({ type: 'SET_STATUS', id: 'check_enterprise', status: 'success' });
      void saveProgressRef.current('check_enterprise');
      setCurrentStepIndex(3);
    } else {
      dispatchRef.current({ type: 'SET_STATUS', id: 'check_enterprise', status: 'error', errorMessage: r.error });
    }
  }, []);

  const runCreateDir = useCallback(async () => {
    dispatchRef.current({ type: 'SET_STATUS', id: 'create_dir', status: 'running' });
    try {
      await mkdir(versionPathRef.current, { recursive: true });
      dispatchRef.current({
        type: 'SET_STATUS', id: 'create_dir', status: 'success',
        errorMessage: versionPathRef.current,
      });
      void saveProgressRef.current('create_dir');
      setCurrentStepIndex(4);
    } catch (err) {
      dispatchRef.current({
        type: 'SET_STATUS', id: 'create_dir', status: 'error',
        errorMessage: (err as NodeJS.ErrnoException).message,
      });
    }
  }, []);

  const runCloneCommunity = useCallback(async () => {
    dispatchRef.current({ type: 'SET_STATUS', id: 'clone_community', status: 'running' });
    setCloneProgress(null);
    const dest = join(versionPathRef.current, 'community');
    if (await dirExists(dest)) {
      dispatchRef.current({ type: 'SET_STATUS', id: 'clone_community', status: 'success', errorMessage: `${dest} (déjà présent)` });
      void saveProgressRef.current('clone_community');
      setCurrentStepIndex(5);
      return;
    }
    let lastUpdate = 0;
    const r = await cloneRepo(ODOO_COMMUNITY_URL, dest, branchNameRef.current, progress => {
      const now = Date.now();
      if (now - lastUpdate >= 80) { // ~12 fps max
        lastUpdate = now;
        setCloneProgress(progress);
      }
    });
    setCloneProgress(null);
    if (r.ok) {
      dispatchRef.current({ type: 'SET_STATUS', id: 'clone_community', status: 'success', errorMessage: dest });
      void saveProgressRef.current('clone_community');
      setCurrentStepIndex(5);
    } else {
      dispatchRef.current({ type: 'SET_STATUS', id: 'clone_community', status: 'error', errorMessage: r.error });
    }
  }, []);

  const runCloneEnterprise = useCallback(async () => {
    dispatchRef.current({ type: 'SET_STATUS', id: 'clone_enterprise', status: 'running' });
    setCloneProgress(null);
    const dest = join(versionPathRef.current, 'enterprise');
    if (await dirExists(dest)) {
      dispatchRef.current({ type: 'SET_STATUS', id: 'clone_enterprise', status: 'success', errorMessage: `${dest} (déjà présent)` });
      void saveProgressRef.current('clone_enterprise');
      setCurrentStepIndex(6);
      return;
    }
    let lastUpdate = 0;
    const r = await cloneRepo(ODOO_ENTERPRISE_URL, dest, branchNameRef.current, progress => {
      const now = Date.now();
      if (now - lastUpdate >= 80) {
        lastUpdate = now;
        setCloneProgress(progress);
      }
    });
    setCloneProgress(null);
    if (r.ok) {
      dispatchRef.current({ type: 'SET_STATUS', id: 'clone_enterprise', status: 'success', errorMessage: dest });
      void saveProgressRef.current('clone_enterprise');
      setCurrentStepIndex(6);
    } else {
      dispatchRef.current({ type: 'SET_STATUS', id: 'clone_enterprise', status: 'error', errorMessage: r.error });
    }
  }, []);

  const runCreateVenv = useCallback(async () => {
    dispatchRef.current({ type: 'SET_STATUS', id: 'create_venv', status: 'running' });
    const venvPath = join(versionPathRef.current, '.venv');
    const r = await createVenv(venvPath);
    if (r.ok) {
      dispatchRef.current({ type: 'SET_STATUS', id: 'create_venv', status: 'success', errorMessage: venvPath });
      void saveProgressRef.current('create_venv');
      setCurrentStepIndex(7);
    } else {
      dispatchRef.current({ type: 'SET_STATUS', id: 'create_venv', status: 'error', errorMessage: r.error });
    }
  }, []);

  const runInstallRequirements = useCallback(async () => {
    dispatchRef.current({ type: 'SET_STATUS', id: 'install_requirements', status: 'running' });
    setPipOutput('');
    const pipPath = join(versionPathRef.current, '.venv', 'bin', 'pip');
    const requirementsPath = join(versionPathRef.current, 'community', 'requirements.txt');
    const r = await installRequirements(pipPath, requirementsPath, line => {
      setPipOutput(line);
    });
    if (r.ok) {
      dispatchRef.current({ type: 'SET_STATUS', id: 'install_requirements', status: 'success' });
      void saveProgressRef.current('install_requirements');
      setCurrentStepIndex(8);
    } else {
      dispatchRef.current({ type: 'SET_STATUS', id: 'install_requirements', status: 'error', errorMessage: r.error });
    }
  }, []);

  const runCreateExtras = useCallback(async () => {
    dispatchRef.current({ type: 'SET_STATUS', id: 'create_extras', status: 'running' });
    const base = versionPathRef.current;
    const branch = branchNameRef.current;
    try {
      await mkdir(join(base, 'custom'), { recursive: true });
      await mkdir(join(base, 'config'), { recursive: true });
      const current = await readConfig();
      // Remove from pending_installs and add to odoo_versions atomically
      const { [branch]: _removed, ...restPending } = current.pending_installs ?? {};
      await writeConfig({
        ...current,
        odoo_versions: { ...current.odoo_versions, [branch]: { branch, path: base } },
        pending_installs: restPending,
      });
      dispatchRef.current({ type: 'SET_STATUS', id: 'create_extras', status: 'success' });
      setDone(true);
    } catch (err) {
      dispatchRef.current({
        type: 'SET_STATUS', id: 'create_extras', status: 'error',
        errorMessage: (err as NodeJS.ErrnoException).message,
      });
    }
  }, []);

  useEffect(() => {
    if (currentStepIndex === 0) return;
    switch (currentStepIndex) {
      case 1: void runCheckCommunity(); break;
      case 2: void runCheckEnterprise(); break;
      case 3: void runCreateDir(); break;
      case 4: void runCloneCommunity(); break;
      case 5: void runCloneEnterprise(); break;
      case 6: void runCreateVenv(); break;
      case 7: void runInstallRequirements(); break;
      case 8: void runCreateExtras(); break;
    }
    // retryCount in deps: re-triggers the current step when user retries
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStepIndex, retryCount, runCheckCommunity, runCheckEnterprise, runCreateDir, runCloneCommunity, runCloneEnterprise, runCreateVenv, runInstallRequirements, runCreateExtras]);

  const isCloneStep = currentStepIndex === 4 || currentStepIndex === 5;
  const isPipStep = currentStepIndex === 7;
  const errorStep = steps.find(s => s.status === 'error');
  const cloneLabel = currentStepIndex === 4 ? 'community' : 'enterprise';

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="row" flexGrow={1}>
        <LeftPanel width={leftWidth} primaryColor={getPrimaryColor(config)} />

        <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
          <Text color={getPrimaryColor(config)} bold>Installer une version</Text>

          {/* Branch input + pending installs */}
          {currentStepIndex === 0 && (
            <Box flexDirection="column" gap={1} marginTop={1}>

              {/* Text input — hidden when navigating pending list */}
              {focus === 'input' ? (
                <>
                  <Text color="white">Nom de la branche Odoo (ex : 17.0, 16.0) :</Text>
                  <Box>
                    <Text color="gray" dimColor>{'› '}</Text>
                    <TextInput
                      value={branchInput}
                      onChange={v => { setBranchInput(v); setInputError(null); }}
                      onSubmit={handleBranchSubmit}
                      placeholder="17.0"
                    />
                  </Box>
                  {inputError && <Text color="red">{inputError}</Text>}
                  <Text color="gray" dimColor>
                    {'↵ valider  ·  Échap retour'}
                    {pendingInstalls.length > 0 ? '  ·  ↓ reprises' : ''}
                    {installedVersions.length > 0 ? '  ·  ↓ installées' : ''}
                  </Text>
                </>
              ) : (
                <Text color="gray" dimColor>Nom de la branche Odoo (ex : 17.0, 16.0)</Text>
              )}

              {/* Pending installs list */}
              {pendingInstalls.length > 0 && (
                <Box flexDirection="column" gap={0} marginTop={1}>
                  <Text color="yellow" bold>Installations en cours :</Text>
                  {pendingInstalls.map((p, i) => {
                    const isSelected = focus === 'pending' && i === pendingSelected;
                    const lastIdx = p.lastCompletedStep
                      ? STEP_DEFS.findIndex(s => s.id === p.lastCompletedStep)
                      : -1;
                    const nextStep = STEP_DEFS[lastIdx + 1];
                    const resumeLabel = nextStep?.label ?? '–';
                    return (
                      <Text
                        key={p.branch}
                        color={isSelected ? 'black' : 'white'}
                        backgroundColor={isSelected ? 'yellow' : undefined}
                        bold={isSelected}
                      >
                        {` ${isSelected ? '▶' : ' '} ${p.branch}  `}
                        <Text color={isSelected ? 'black' : 'gray'} dimColor={!isSelected}>
                          {`reprendre depuis : ${resumeLabel}`}
                        </Text>
                      </Text>
                    );
                  })}
                  {focus === 'pending' && (
                    <Text color="gray" dimColor>{'↑↓ naviguer  ·  ↵ reprendre  ·  Échap retour'}</Text>
                  )}
                </Box>
              )}

              {/* Installed versions list */}
              {installedVersions.length > 0 && (
                <Box flexDirection="column" gap={0} marginTop={1}>
                  <Text color="white" bold>Versions installées :</Text>
                  {installedVersions.map((v, i) => {
                    const isSelected = focus === 'installed' && i === installedSelected;
                    return (
                      <Text
                        key={v.branch}
                        color={isSelected ? 'black' : 'white'}
                        backgroundColor={isSelected ? 'cyan' : undefined}
                        bold={isSelected}
                      >
                        {` ${isSelected ? '▶' : ' '} ${v.branch}  `}
                        <Text color={isSelected ? 'black' : 'gray'} dimColor={!isSelected}>
                          {v.path}
                        </Text>
                      </Text>
                    );
                  })}
                  {focus === 'installed' && (
                    <Text color="gray" dimColor>{'↑↓ naviguer  ·  ↵ relancer  ·  Échap retour'}</Text>
                  )}
                </Box>
              )}
            </Box>
          )}

          {/* Running — non-clone steps */}
          {currentStepIndex > 0 && !isCloneStep && !done && !errorStep && (
            <Box marginTop={1} flexDirection="column" gap={0}>
              <Text color="gray">
                {'Installation de '}
                <Text color={getPrimaryColor(config)} bold>{branchName}</Text>
                {'…'}
              </Text>
              {isPipStep && pipOutput !== '' && (
                <Text color="gray" dimColor>{pipOutput}</Text>
              )}
            </Box>
          )}

          {/* Error recovery actions */}
          {errorStep && currentStepIndex > 0 && (
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
              <Text color="gray" dimColor>{'◀▶ choisir  ·  ↵ confirmer  ·  Échap retour'}</Text>
            </Box>
          )}

          {/* Running — clone steps with progress bar */}
          {isCloneStep && !errorStep && (
            <Box flexDirection="column" marginTop={1} gap={0}>
              <Text color="gray">
                {'Clonage '}
                <Text color={getPrimaryColor(config)} bold>{cloneLabel}</Text>
                {` → ${join(versionPath, cloneLabel)}`}
              </Text>
              <Box marginTop={1} flexDirection="column" gap={0}>
                {cloneProgress ? (
                  <>
                    <ProgressBar percent={cloneProgress.percent} />
                    <Box gap={2} marginTop={0}>
                      <Text color="gray" dimColor>
                        {PHASE_LABEL[cloneProgress.phase]}
                      </Text>
                      {cloneProgress.speed && (
                        <Text color={getPrimaryColor(config)} dimColor>{cloneProgress.speed}</Text>
                      )}
                    </Box>
                  </>
                ) : (
                  <Text color="gray" dimColor>⟳ Connexion au dépôt…</Text>
                )}
              </Box>
            </Box>
          )}

          {/* Done */}
          {done && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text color="green">
                {'✓ '}
                <Text bold>{branchName}</Text>
                {' installé avec succès.'}
              </Text>
              <Box flexDirection="column" gap={0}>
                <Text color="gray" dimColor>{`  community/  → ${join(versionPath, 'community')}`}</Text>
                <Text color="gray" dimColor>{`  enterprise/ → ${join(versionPath, 'enterprise')}`}</Text>
                <Text color="gray" dimColor>{`  .venv/      → ${join(versionPath, '.venv')}`}</Text>
                <Text color="gray" dimColor>{`  custom/`}</Text>
                <Text color="gray" dimColor>{`  config/`}</Text>
              </Box>
              <Text color="white">{'Échap retour'}</Text>
            </Box>
          )}
        </Box>
      </Box>

      <StepsPanel steps={steps} />
      <ErrorPanel steps={steps} />
    </Box>
  );
}
