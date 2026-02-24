import React from 'react';
import { Box, Text } from 'ink';
import { AnyStep } from '../types/index.js';

interface ErrorPanelProps {
  steps: AnyStep[];
}

export function ErrorPanel({ steps }: ErrorPanelProps) {
  const errorStep = steps.find(s => s.status === 'error');
  if (!errorStep) return null;

  return (
    <Box
      borderStyle="single"
      borderColor="red"
      paddingX={2}
      paddingY={0}
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
    >
      <Text color="red">
        {'✗ '}
        {errorStep.label}
        {errorStep.errorMessage ? ` : ${errorStep.errorMessage}` : ''}
      </Text>
    </Box>
  );
}
