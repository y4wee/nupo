import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { spawn } from 'node:child_process';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const { name: packageName } = _require('../../package.json') as { name: string };

interface UpdateScreenProps {
  termWidth: number;
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
  onComplete: () => void;
  onError: (msg: string) => void;
}

const BAR_PADDING = 6; // paddingX * 2 + some margin

export function UpdateScreen({ termWidth, primaryColor, secondaryColor, textColor, onComplete, onError }: UpdateScreenProps) {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const doneRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  onCompleteRef.current = onComplete;
  onErrorRef.current = onError;

  const barWidth = Math.max(10, termWidth - BAR_PADDING - 8); // 8 = "  XXX%  "

  useEffect(() => {
    // Animate progress up to 90% while npm runs
    const timer = setInterval(() => {
      setProgress(prev => {
        if (doneRef.current || prev >= 90) return prev;
        // Accelerate early, slow down near 90
        const step = prev < 50 ? 2 : 1;
        return Math.min(prev + step, 90);
      });
    }, 400);

    // Run npm install -g
    const child = spawn('npm', ['install', '-g', packageName], {
      stdio: 'pipe',
      env: process.env,
    });

    child.on('exit', code => {
      clearInterval(timer);
      if (code === 0) {
        doneRef.current = true;
        setProgress(100);
        setDone(true);
        setTimeout(() => onCompleteRef.current(), 800);
      } else {
        onErrorRef.current(`npm exited with code ${String(code)}`);
      }
    });

    child.on('error', err => {
      clearInterval(timer);
      onErrorRef.current(err.message);
    });

    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filled = Math.round((progress / 100) * barWidth);
  const empty = barWidth - filled;

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={primaryColor} width={termWidth}>
      <Box flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={secondaryColor} bold>Mise à jour en cours</Text>

        <Box flexDirection="column" gap={1} marginTop={1}>
          <Box>
            <Text color={secondaryColor}>{'█'.repeat(filled)}</Text>
            <Text color={textColor} dimColor>{'░'.repeat(empty)}</Text>
            <Text color={textColor}>{`  ${String(progress).padStart(3)}%`}</Text>
          </Box>

          <Text color={textColor} dimColor>
            {done ? '✓ Installation terminée — redémarrage…' : `Installation de ${packageName}…`}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
