import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { NupoConfig, getPrimaryColor, getSecondaryColor, getTextColor } from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { CHANGELOG, EntryType } from '../data/changelog.js';

interface ChangelogScreenProps {
  config: NupoConfig | null;
  leftWidth: number;
  onBack: () => void;
}

const TYPE_COLOR: Record<EntryType, string> = {
  feat:  'green',
  fix:   'yellow',
  chore: 'gray',
};

const TYPE_LABEL: Record<EntryType, string> = {
  feat:  'feat',
  fix:   'fix ',
  chore: 'chore',
};

// Flatten changelog into renderable lines for uniform scrolling
type Line =
  | { kind: 'version'; version: string; date: string }
  | { kind: 'entry';   type: EntryType; label: string }
  | { kind: 'spacer' };

function buildLines(): Line[] {
  const lines: Line[] = [];
  for (const v of CHANGELOG) {
    lines.push({ kind: 'version', version: v.version, date: v.date });
    for (const e of v.entries) {
      lines.push({ kind: 'entry', type: e.type, label: e.label });
    }
    lines.push({ kind: 'spacer' });
  }
  return lines;
}

const ALL_LINES = buildLines();

export function ChangelogScreen({ config, leftWidth, onBack }: ChangelogScreenProps) {
  const { rows } = useTerminalSize();
  const textColor      = getTextColor(config);
  const primaryColor   = getPrimaryColor(config);
  const secondaryColor = getSecondaryColor(config);

  // rows - borders(2) - header(2) - title(2) - hint(2) - padding(2)
  const visibleLines = Math.max(4, rows - 10);
  const maxScroll    = Math.max(0, ALL_LINES.length - visibleLines);
  const maxScrollRef = useRef(maxScroll);
  maxScrollRef.current = maxScroll;

  const [scrollOffset, setScrollOffset] = useState(0);

  useInput((_char, key) => {
    if (key.escape) { onBack(); return; }
    if (key.upArrow)   setScrollOffset(p => Math.max(0, p - 1));
    if (key.downArrow) setScrollOffset(p => Math.min(maxScrollRef.current, p + 1));
  });

  const offset  = Math.min(scrollOffset, maxScroll);
  const visible = ALL_LINES.slice(offset, offset + visibleLines);

  const canUp   = offset > 0;
  const canDown = offset < maxScroll;

  return (
    <Box flexDirection="row" flexGrow={1}>
      <LeftPanel width={leftWidth} primaryColor={primaryColor} textColor={textColor} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={secondaryColor} bold>Notes de mise à jour</Text>

        <Box flexDirection="column" gap={0} flexGrow={1}>
          {visible.map((line, i) => {
            if (line.kind === 'spacer') {
              return <Text key={i}>{' '}</Text>;
            }
            if (line.kind === 'version') {
              return (
                <Box key={i} flexDirection="row" gap={2}>
                  <Text color={secondaryColor} bold>{`v${line.version}`}</Text>
                  <Text color={textColor} dimColor>{line.date}</Text>
                </Box>
              );
            }
            return (
              <Box key={i} flexDirection="row" gap={1}>
                <Text color={textColor} dimColor>{'  '}</Text>
                <Text color={TYPE_COLOR[line.type]}>{`[${TYPE_LABEL[line.type]}]`}</Text>
                <Text color={textColor}>{line.label}</Text>
              </Box>
            );
          })}
        </Box>

        <Box flexDirection="row" gap={2}>
          <Text color={textColor} dimColor>
            {canUp   ? '↑ remonter  ' : '            '}
            {canDown ? '↓ descendre  ' : '             '}
            {'Échap retour'}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
