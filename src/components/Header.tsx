import React from 'react';
import { Box, Text } from 'ink';
import { createRequire } from 'module';
import { OdooServiceConfig } from '../types/index.js';

const _require = createRequire(import.meta.url);
const { version } = _require('../../package.json') as { version: string };

interface HeaderProps {
  activeService?: OdooServiceConfig | null;
  serviceRunning?: boolean;
  primaryColor?: string;
  secondaryColor?: string;
}

export function Header({ activeService, serviceRunning, primaryColor = '#9F0C58', secondaryColor = '#E79439' }: HeaderProps) {
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
      <Text color={primaryColor} bold>nupO</Text>
      <Text color={secondaryColor} dimColor>v{version}</Text>

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
