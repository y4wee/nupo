import React from 'react';
import { Box, Text } from 'ink';
import { AnyStep, StepStatus } from '../types/index.js';

const STATUS_ICON: Record<StepStatus, string> = {
  pending: '○',
  running: '⟳',
  success: '✓',
  error: '✗',
};

const STATUS_COLOR: Record<StepStatus, string> = {
  pending: 'gray',
  running: 'yellow',
  success: 'green',
  error: 'red',
};

interface StepsPanelProps {
  steps: AnyStep[];
  textColor?: string;
}

export function StepsPanel({ steps, textColor = '#848484' }: StepsPanelProps) {
  if (steps.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={2}
      paddingY={0}
    >
      {steps.map(step => (
        <Box key={step.id} flexDirection="row" gap={1}>
          <Text color={STATUS_COLOR[step.status]}>{STATUS_ICON[step.status]}</Text>
          <Text color="white">{step.label}</Text>
          {step.status === 'success' && step.errorMessage && (
            <Text color={textColor} dimColor>
              {'  '}
              {step.errorMessage}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
