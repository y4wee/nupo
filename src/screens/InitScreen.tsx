import React, { useReducer, useEffect, useState, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { PathInput } from '../components/PathInput.js';
import { access } from 'fs/promises';
import { InitStep, InitStepId, StepStatus, NupoConfig, getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor } from '../types/index.js';
import { checkPython, checkPip, checkVenv, checkSSH, generateSSHKey, verifySSHKey, addSSHConfig } from '../services/checks.js';
import { patchConfig } from '../services/config.js';
import { copyToClipboard, ClipboardResult } from '../services/system.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { StepsPanel } from '../components/StepsPanel.js';
import { ErrorPanel } from '../components/ErrorPanel.js';

interface InitScreenProps {
  config: NupoConfig | null;
  leftWidth: number;
  onComplete: () => void;
}

type StepAction =
  | { type: 'SET_STATUS'; id: InitStepId; status: StepStatus; errorMessage?: string }
  | { type: 'INIT'; steps: InitStep[] };

function stepsReducer(state: InitStep[], action: StepAction): InitStep[] {
  switch (action.type) {
    case 'INIT':
      return action.steps;
    case 'SET_STATUS':
      return state.map(s =>
        s.id === action.id ? { ...s, status: action.status, errorMessage: action.errorMessage } : s,
      );
    default:
      return state;
  }
}

const STEP_DEFS: { id: InitStepId; label: string }[] = [
  { id: 'python',    label: 'Vérification de Python' },
  { id: 'pip',       label: 'Vérification de pip' },
  { id: 'venv',      label: 'Vérification de python venv' },
  { id: 'check_ssh', label: 'Connexion SSH GitHub' },
  { id: 'odoo_path', label: 'Chemin du dépôt Odoo' },
];

function findStartIndex(config: NupoConfig | null): number {
  if (!config) return 0;
  if (!config.python_installed) return 0;
  if (!config.pip_installed) return 1;
  if (!config.venv_installed) return 2;
  if (!config.ssh_configured) return 3;
  if (!config.odoo_path_repo) return 4;
  return 5;
}

function buildInitialSteps(startIndex: number): InitStep[] {
  return STEP_DEFS.map((def, i) => ({
    ...def,
    status: (i < startIndex ? 'success' : 'pending') as StepStatus,
  }));
}

export function InitScreen({ config, leftWidth, onComplete }: InitScreenProps) {
  const textColor = getTextColor(config);
  const startIndex = findStartIndex(config);
  const [steps, dispatch] = useReducer(stepsReducer, buildInitialSteps(startIndex));
  const [currentStepIndex, setCurrentStepIndex] = useState(startIndex);
  const [odooPath, setOdooPath] = useState('');
  const [waitingInput, setWaitingInput] = useState(false);
  const [done, setDone] = useState(startIndex >= 5);

  // SSH sub-flow
  type SshPhase = 'choice' | 'generating' | 'instructions' | 'verifying';
  const [sshPhase,   setSshPhase]   = useState<SshPhase | null>(null);
  const [sshChoice,  setSshChoice]  = useState<0 | 1>(0); // 0=Non (default), 1=Oui
  const [sshPubKey,  setSshPubKey]  = useState('');
  const [sshKeyPath, setSshKeyPath] = useState('');
  const [sshError,   setSshError]   = useState<string | null>(null);
  const [sshCopied,  setSshCopied]  = useState<'idle' | ClipboardResult>('idle');
  const sshCopyReadyRef = useRef(false);

  // Reset copy state and guard delay when entering instructions phase
  useEffect(() => {
    if (sshPhase !== 'instructions') return;
    setSshCopied('idle');
    sshCopyReadyRef.current = false;
    const t = setTimeout(() => { sshCopyReadyRef.current = true; }, 200);
    return () => clearTimeout(t);
  }, [sshPhase]);

  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const runPython = useCallback(async () => {
    dispatchRef.current({ type: 'SET_STATUS', id: 'python', status: 'running' });
    const result = await checkPython();
    if (result.ok) {
      dispatchRef.current({
        type: 'SET_STATUS',
        id: 'python',
        status: 'success',
        errorMessage: result.version,
      });
      await patchConfig({ python_installed: true });
      setCurrentStepIndex(1);
    } else {
      dispatchRef.current({
        type: 'SET_STATUS',
        id: 'python',
        status: 'error',
        errorMessage: result.error,
      });
    }
  }, []);

  const runPip = useCallback(async () => {
    dispatchRef.current({ type: 'SET_STATUS', id: 'pip', status: 'running' });
    const result = await checkPip();
    if (result.ok) {
      dispatchRef.current({
        type: 'SET_STATUS',
        id: 'pip',
        status: 'success',
        errorMessage: result.version,
      });
      await patchConfig({ pip_installed: true });
      setCurrentStepIndex(2);
    } else {
      dispatchRef.current({
        type: 'SET_STATUS',
        id: 'pip',
        status: 'error',
        errorMessage: result.error,
      });
    }
  }, []);

  const runVenv = useCallback(async () => {
    dispatchRef.current({ type: 'SET_STATUS', id: 'venv', status: 'running' });
    const result = await checkVenv();
    if (result.ok) {
      dispatchRef.current({ type: 'SET_STATUS', id: 'venv', status: 'success', errorMessage: 'disponible' });
      await patchConfig({ venv_installed: true });
      setCurrentStepIndex(3);
    } else {
      dispatchRef.current({ type: 'SET_STATUS', id: 'venv', status: 'error', errorMessage: result.error });
    }
  }, []);

  const advanceFromSSH = useCallback(async () => {
    await patchConfig({ ssh_configured: true });
    setCurrentStepIndex(4);
  }, []);

  const runSSH = useCallback(async () => {
    dispatchRef.current({ type: 'SET_STATUS', id: 'check_ssh', status: 'running' });
    const result = await checkSSH();
    if (result.ok) {
      dispatchRef.current({ type: 'SET_STATUS', id: 'check_ssh', status: 'success', errorMessage: 'connecté' });
      await patchConfig({ ssh_configured: true });
      setCurrentStepIndex(4);
    } else {
      // Non-blocking: show choice (default = Non)
      setSshPhase('choice');
      setSshChoice(0);
    }
  }, []);

  const runSSHSetup = useCallback(async () => {
    setSshPhase('generating');
    const result = await generateSSHKey();
    if (!result.ok || !result.publicKey || !result.keyPath) {
      dispatchRef.current({ type: 'SET_STATUS', id: 'check_ssh', status: 'error', errorMessage: result.error });
      setSshPhase(null);
      return;
    }
    setSshPubKey(result.publicKey);
    setSshKeyPath(result.keyPath);
    setSshCopied('idle');
    setSshPhase('instructions');
  }, []);

  const runSSHVerify = useCallback(async (keyPath: string) => {
    setSshPhase('verifying');
    setSshError(null);
    const result = await verifySSHKey(keyPath);
    if (result.ok) {
      await addSSHConfig(keyPath);
      dispatchRef.current({ type: 'SET_STATUS', id: 'check_ssh', status: 'success', errorMessage: 'connecté' });
      setSshPhase(null);
      await patchConfig({ ssh_configured: true });
      setCurrentStepIndex(4);
    } else {
      setSshError('Clé non reconnue par GitHub. Vérifiez que vous avez bien ajouté la clé.');
      setSshPhase('instructions');
    }
  }, []);

  const runOdooPath = useCallback(async (inputPath: string) => {
    const resolvedPath = inputPath.trim() || process.cwd();
    setWaitingInput(false);
    try {
      await access(resolvedPath);
      dispatchRef.current({
        type: 'SET_STATUS',
        id: 'odoo_path',
        status: 'success',
        errorMessage: resolvedPath,
      });
      await patchConfig({ odoo_path_repo: resolvedPath, initiated: true });
      setCurrentStepIndex(4);
      setDone(true);
    } catch {
      dispatchRef.current({
        type: 'SET_STATUS',
        id: 'odoo_path',
        status: 'error',
        errorMessage: `Chemin introuvable : ${resolvedPath}`,
      });
      setWaitingInput(true);
    }
  }, []);

  // Trigger auto steps or input prompt based on current step
  useEffect(() => {
    if (currentStepIndex === 0) {
      void runPython();
    } else if (currentStepIndex === 1) {
      void runPip();
    } else if (currentStepIndex === 2) {
      void runVenv();
    } else if (currentStepIndex === 3) {
      void runSSH();
    } else if (currentStepIndex === 4) {
      dispatchRef.current({ type: 'SET_STATUS', id: 'odoo_path', status: 'running' });
      setWaitingInput(true);
    }
  }, [currentStepIndex, runPython, runPip, runVenv, runSSH]);

  // Call onComplete once all steps are done
  useEffect(() => {
    if (!done) return;
    onCompleteRef.current();
  }, [done]);

  // SSH choice navigation
  useInput(
    (_char, key) => {
      if (key.leftArrow || key.rightArrow) setSshChoice(c => (c === 0 ? 1 : 0));
      if (key.return) {
        if (sshChoice === 1) {
          void runSSHSetup();
        } else {
          dispatchRef.current({ type: 'SET_STATUS', id: 'check_ssh', status: 'success', errorMessage: 'ignoré' });
          void advanceFromSSH();
          setSshPhase(null);
        }
      }
    },
    { isActive: sshPhase === 'choice' },
  );

  // SSH instructions: C = copy key, Enter = verify
  useInput(
    (_char, key) => {
      if (_char === 'c' && sshPubKey && sshCopyReadyRef.current) {
        setSshCopied(copyToClipboard(sshPubKey));
      } else if (key.return) {
        void runSSHVerify(sshKeyPath);
      }
    },
    { isActive: sshPhase === 'instructions' },
  );

  const errorStep = steps.find(s => s.status === 'error');

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="row" flexGrow={1}>
        <LeftPanel width={leftWidth} primaryColor={getPrimaryColor(config)} textColor={textColor} />

        <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
          <Text color={getSecondaryColor(config)} bold>
            Initialisation
          </Text>

          {/* SSH choice */}
          {sshPhase === 'choice' && (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text color="white">Connexion SSH GitHub non configurée.</Text>
              <Text color={textColor}>Voulez-vous configurer une clé SSH ?</Text>
              <Box gap={2}>
                <Text
                  color={sshChoice === 0 ? 'black' : textColor}
                  backgroundColor={sshChoice === 0 ? getCursorColor(config) : undefined}
                  bold={sshChoice === 0}
                >{' Non '}</Text>
                <Text
                  color={sshChoice === 1 ? 'black' : textColor}
                  backgroundColor={sshChoice === 1 ? getCursorColor(config) : undefined}
                  bold={sshChoice === 1}
                >{' Oui '}</Text>
              </Box>
              <Text color={textColor} dimColor>◀▶ choisir  ·  ↵ confirmer</Text>
            </Box>
          )}

          {/* SSH key generation in progress */}
          {sshPhase === 'generating' && (
            <Box marginTop={1}>
              <Text color={textColor} dimColor>⟳ Génération de la clé SSH…</Text>
            </Box>
          )}

          {/* SSH instructions */}
          {(sshPhase === 'instructions' || sshPhase === 'verifying') && (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text color="white" bold>Clé SSH générée : <Text color={textColor} bold={false}>{sshKeyPath}.pub</Text></Text>
              <Box flexDirection="column" gap={0}>
                <Text color={getSecondaryColor(config)}>Copiez cette clé publique :</Text>
                <Text color="cyan">{sshPubKey}</Text>
                {sshCopied === 'ok'      && <Text color="green">✓ Copié dans le presse-papier !</Text>}
                {sshCopied === 'no_tool' && <Text color="yellow">Installez xclip pour la copie auto :  sudo apt install xclip</Text>}
                {sshCopied === 'idle'    && <Text color={textColor} dimColor>C copier la clé</Text>}
              </Box>
              <Box flexDirection="column" gap={0}>
                <Text color="white">Puis ajoutez-la sur GitHub :</Text>
                <Text color={textColor} dimColor>  1. github.com → Settings → SSH and GPG keys</Text>
                <Text color={textColor} dimColor>  2. New SSH key → collez la clé → Save</Text>
              </Box>
              {sshError && <Text color="red">{sshError}</Text>}
              {sshPhase === 'verifying'
                ? <Text color={textColor} dimColor>⟳ Vérification en cours…</Text>
                : <Text color={textColor} dimColor>↵ Vérifier la connexion une fois la clé ajoutée  ·  C copier</Text>
              }
            </Box>
          )}

          {waitingInput && !errorStep && (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text color="white">Chemin vers le dépôt Odoo :</Text>
              <Box>
                <Text color={textColor} dimColor>{'› '}</Text>
                <PathInput
                  value={odooPath}
                  onChange={setOdooPath}
                  onSubmit={val => void runOdooPath(val)}
                  placeholder={process.cwd()}
                  textColor={textColor}
                />
              </Box>
              <Text color={textColor} dimColor>
                Appuyez sur Entrée pour utiliser le répertoire courant
              </Text>
            </Box>
          )}

          {errorStep && (
            <Box flexDirection="column" gap={1} marginTop={1}>
              <Text color="red">Étape échouée : {errorStep.label}</Text>
              {errorStep.errorMessage && (
                <Box flexDirection="column" gap={0}>
                  <Text color={textColor}>Pour installer :</Text>
                  {errorStep.errorMessage.split('\n').map((line, i) => (
                    <Text key={i} color="cyan">{`  ${line}`}</Text>
                  ))}
                </Box>
              )}
              <Text color={textColor} dimColor>Relancez nupo une fois corrigé.</Text>
            </Box>
          )}

          {!waitingInput && !errorStep && !done && (
            <Box marginTop={1}>
              <Text color={textColor} dimColor>
                ⟳ Vérification en cours…
              </Text>
            </Box>
          )}
        </Box>
      </Box>

      <StepsPanel steps={steps} textColor={textColor} />
      <ErrorPanel steps={steps} />
    </Box>
  );
}
