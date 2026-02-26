import React, { useState } from 'react';
import { Box, useInput } from 'ink';
import { LeftPanel } from '../components/LeftPanel.js';
import { OptionsPanel } from '../components/OptionsPanel.js';
import { MenuOption, Screen } from '../types/index.js';

interface HomeScreenProps {
  leftWidth: number;
  options: MenuOption[];
  isActive: boolean;
  primaryColor?: string;
  secondaryColor?: string;
  textColor?: string;
  cursorColor?: string;
  onNavigate: (screen: Screen) => void;
}

export function HomeScreen({ leftWidth, options, isActive, primaryColor, secondaryColor, textColor, cursorColor, onNavigate }: HomeScreenProps) {
  const [selected, setSelected] = useState(0);

  useInput(
    (_char, key) => {
      if (key.upArrow) {
        setSelected(prev => (prev - 1 + options.length) % Math.max(options.length, 1));
      }
      if (key.downArrow) {
        setSelected(prev => (prev + 1) % Math.max(options.length, 1));
      }
      if (key.return && options.length > 0) {
        const opt = options[selected];
        if (opt) onNavigate(opt.screen);
      }
    },
    { isActive },
  );

  const safeSelected = Math.min(selected, Math.max(0, options.length - 1));

  return (
    <Box flexDirection="row">
      <LeftPanel width={leftWidth} primaryColor={primaryColor} />
      <OptionsPanel options={options} selected={safeSelected} secondaryColor={secondaryColor} textColor={textColor} cursorColor={cursorColor} />
    </Box>
  );
}
