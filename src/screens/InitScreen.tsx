import React, { useReducer, useEffect, useState, useCallback, useRef } from 'react';
import { Box, Text } from 'ink';
import { PathInput } from '../components/PathInput.js';
import { access } from 'fs/promises';
import { InitStep, InitStepId, StepStatus, NupoConfig, getPrimaryColor, getSecondaryColor, getTextColor } from '../types/index.js';
import { checkPython, checkPip } from '../services/checks.js';
import { patchConfig } from '../services/config.js';
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
  { id: 'python', label: 'Vérification de Python' },
  { id: 'pip', label: 'Vérification de pip' },
  { id: 'odoo_path', label: 'Chemin du dépôt Odoo' },
];

function findStartIndex(config: NupoConfig | null): number {
  if (!config) return 0;
  if (!config.python_installed) return 0;
  if (!config.pip_installed) return 1;
  if (!config.odoo_path_repo) return 2;
  return 3;
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
  const [done, setDone] = useState(startIndex >= 3);

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
      setCurrentStepIndex(3);
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
      dispatchRef.current({ type: 'SET_STATUS', id: 'odoo_path', status: 'running' });
      setWaitingInput(true);
    }
  }, [currentStepIndex, runPython, runPip]);

  // Call onComplete once all steps are done
  useEffect(() => {
    if (!done) return;
    onCompleteRef.current();
  }, [done]);

  const errorStep = steps.find(s => s.status === 'error');

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="row" flexGrow={1}>
        <LeftPanel width={leftWidth} primaryColor={getPrimaryColor(config)} textColor={textColor} />

        <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
          <Text color={getSecondaryColor(config)} bold>
            Initialisation
          </Text>

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
              <Text color={textColor}>Corrigez l&apos;erreur et relancez nupo.</Text>
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
