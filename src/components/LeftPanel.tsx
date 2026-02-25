import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const LOGO = `╔═╗
║N║
║U║
╚═╝`.trim();

const WELCOME = 'Bienvenue\nNuprodien';

interface LeftPanelProps {
  width: number;
  serviceLabel?: string;
}

export function LeftPanel({ width, serviceLabel }: LeftPanelProps) {
  const [typedText, setTypedText] = useState('');

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i++;
      setTypedText(WELCOME.slice(0, i));
      if (i >= WELCOME.length) clearInterval(id);
    }, 60);
    return () => clearInterval(id);
  }, []);

  return (
    <Box
      width={width}
      flexGrow={0}
      flexShrink={0}
      flexDirection="column"
      paddingX={2}
      paddingY={2}
      gap={2}
      borderStyle="single"
      borderColor="gray"
      borderTop={false}
      borderBottom={false}
      borderLeft={false}
      borderRight={true}
    >
      <Text color="cyan">{LOGO}</Text>
      <Box flexDirection="column">
        <Text color="white">{typedText.split('\n')[0] ?? ''}</Text>
        <Text color="cyan" bold>
          {typedText.split('\n')[1] ?? ''}
        </Text>
      </Box>
      {serviceLabel && (
        <Box flexDirection="column" gap={0}>
          <Text color="gray" dimColor>Service</Text>
          <Text color="yellow" bold>{serviceLabel}</Text>
        </Box>
      )}
    </Box>
  );
}
