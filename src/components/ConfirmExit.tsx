import React from 'react';
import { Box, Text } from 'ink';

interface ConfirmExitProps {
  visible: boolean;
  selected: number; // 0 = Oui, 1 = Non
  textColor?: string;
}

export function ConfirmExit({ visible, selected, textColor = '#848484' }: ConfirmExitProps) {
  if (!visible) return null;

  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={0}
      marginX={2}
      marginBottom={1}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
    >
      <Text color="yellow">Voulez-vous vraiment quitter nupo ?</Text>
      <Box flexDirection="row" gap={2}>
        <Text
          color={selected === 0 ? 'black' : 'white'}
          backgroundColor={selected === 0 ? 'yellow' : undefined}
          bold={selected === 0}
        >
          {' Oui '}
        </Text>
        <Text
          color={selected === 1 ? 'black' : 'white'}
          backgroundColor={selected === 1 ? 'cyan' : undefined}
          bold={selected === 1}
        >
          {' Non '}
        </Text>
      </Box>
      <Text color={textColor} dimColor>
        {'◀▶ choisir  ·  ↵ confirmer'}
      </Text>
    </Box>
  );
}
