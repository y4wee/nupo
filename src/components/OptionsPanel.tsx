import React from 'react';
import { Box, Text } from 'ink';
import { MenuOption } from '../types/index.js';

interface OptionsPanelProps {
  options: MenuOption[];
  selected: number;
}

export function OptionsPanel({ options, selected }: OptionsPanelProps) {
  const current = options[selected];

  if (options.length === 0) {
    return (
      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2}>
        <Text color="gray" dimColor>
          Aucune option disponible.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
      <Box borderStyle="round" borderColor="gray" paddingX={1} paddingY={0}>
        <Text color="gray" wrap="wrap">
          {current?.description ?? ''}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1} gap={0}>
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

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {'↑↓ naviguer  ·  ↵ sélectionner'}
        </Text>
      </Box>
    </Box>
  );
}
