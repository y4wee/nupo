import React from 'react';
import { Box, Text } from 'ink';

export function Header() {
  return (
    <Box
      paddingX={1}
      borderStyle="single"
      borderColor="gray"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderBottom={true}
    >
      <Text color="cyan" bold>
        nupo
      </Text>
      <Text color="gray" dimColor>
        {'  v0.1.0'}
      </Text>
    </Box>
  );
}
