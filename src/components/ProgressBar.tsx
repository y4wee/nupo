import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const BAR_WIDTH = 50;

export function ProgressBar({ percent }: { percent: number }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame(f => f + 1), 150);
    return () => clearInterval(id);
  }, []);

  const pos = Math.min(Math.round((percent / 100) * (BAR_WIDTH - 1)), BAR_WIDTH - 1);
  const pacman = frame % 2 === 0 ? 'ᗧ' : '○';
  const eaten = pos;
  const remaining = BAR_WIDTH - 1 - pos;

  return (
    <Box>
      <Text>
        <Text color="yellow">{'─'.repeat(eaten)}{pacman}</Text>
        <Text color="gray" dimColor>{'·'.repeat(remaining)}</Text>
        {` ${String(percent).padStart(3)}%`}
      </Text>
    </Box>
  );
}
