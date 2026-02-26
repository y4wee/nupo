import React from 'react';
import { Box, Text } from 'ink';
import { MenuOption } from '../types/index.js';

interface OptionsPanelProps {
  options: MenuOption[];
  selected: number;
  secondaryColor?: string;
  textColor?: string;
}

export function OptionsPanel({ options, selected, secondaryColor, textColor = '#848484' }: OptionsPanelProps) {
  const current = options[selected];

  if (options.length === 0) {
    return (
      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2}>
        <Text color={textColor} dimColor>
          Aucune option disponible.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
      <Box flexDirection="column" gap={0}>
        {options.map((opt, i) => {
          const isSelected = i === selected;
          return (
            <Text
              key={opt.id}
              color={isSelected ? 'black' : 'white'}
              backgroundColor={isSelected ? 'cyan' : undefined}
              bold={isSelected}
            >
              {` ${isSelected ? '▶' : ' '} ${opt.label}`}
            </Text>
          );
        })}
      </Box>

      <Box>
        <Text color={textColor} dimColor>
          {'↑↓ naviguer  ·  ↵ sélectionner'}
        </Text>
      </Box>

      <Box borderStyle="round" borderColor={secondaryColor ?? 'gray'} paddingX={1} paddingY={0}>
        <Text color={textColor} wrap="wrap">
          {current?.description ?? ''}
        </Text>
      </Box>
    </Box>
  );
}
