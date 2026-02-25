import React from 'react';
import { Box, Text } from 'ink';
import { OdooServiceConfig } from '../types/index.js';

interface HeaderProps {
  activeService?: OdooServiceConfig | null;
  serviceRunning?: boolean;
}

export function Header({ activeService, serviceRunning }: HeaderProps) {
  return (
    <Box
      paddingX={1}
      borderStyle="single"
      borderColor="gray"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderBottom={true}
      flexDirection="row"
      gap={1}
    >
      <Text color="cyan" bold>nupo</Text>
      <Text color="white" dimColor>v0.1.0</Text>

      {activeService && (
        <>
          <Text color="white" dimColor>·</Text>
          <Text color="yellow" bold>{activeService.name}</Text>
          <Text color="white" dimColor>{activeService.branch}</Text>
          <Text color={serviceRunning ? 'green' : 'red'}>
            {serviceRunning ? '● en cours' : '■ arrêté'}
          </Text>
        </>
      )}
    </Box>
  );
}
