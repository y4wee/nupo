import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { Screen, MenuOption, OdooServiceConfig } from './types/index.js';
import { useConfig } from './hooks/useConfig.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { Header } from './components/Header.js';
import { ConfirmExit } from './components/ConfirmExit.js';
import { HomeScreen } from './screens/HomeScreen.js';
import { InitScreen } from './screens/InitScreen.js';
import { OdooScreen } from './screens/OdooScreen.js';
import { ConfigScreen } from './screens/ConfigScreen.js';

interface AppProps {
  onExit: () => void;
}

export function App({ onExit }: AppProps) {
  const { columns, rows } = useTerminalSize();
  const { config, loading, refresh } = useConfig();
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [confirmExit, setConfirmExit] = useState(false);
  const [confirmSelected, setConfirmSelected] = useState(1);
  const [serviceRunning,  setServiceRunning]  = useState(false);
  const [activeService,   setActiveService]   = useState<OdooServiceConfig | null>(null);

  const options = useMemo<MenuOption[]>(
    () =>
      [
        {
          id: 'init',
          label: 'Initialisation',
          description:
            "Configure l'environnement nupo : vérifie Python, pip et le chemin vers le dépôt Odoo.",
          screen: 'init' as Screen,
          visible: !config?.initiated,
        },
        {
          id: 'odoo',
          label: 'Odoo',
          description: 'Accédez aux outils Odoo : démarrage, migration, gestion des modules.',
          screen: 'odoo' as Screen,
          visible: config?.initiated === true,
        },
        {
          id: 'config',
          label: 'Config',
          description: 'Changer la configuration nupo : modifiez les paramètres de votre environnement.',
          screen: 'config' as Screen,
          visible: config?.initiated === true,
        },
      ].filter(o => o.visible),
    [config],
  );

  // Global input: handles Ctrl+C and confirm-exit dialog on all screens
  useInput((char, key) => {
    if (confirmExit) {
      if (key.leftArrow) setConfirmSelected(0);
      if (key.rightArrow) setConfirmSelected(1);
      if (key.return) confirmSelected === 0 ? onExit() : setConfirmExit(false);
      if (key.escape || char === 'n') {
        setConfirmExit(false);
        setConfirmSelected(1);
      }
      if (char === 'o' || char === 'y') onExit();
      if (key.ctrl && char === 'c') onExit();
      return;
    }

    if (key.ctrl && char === 'c' && !serviceRunning) {
      setConfirmExit(true);
      setConfirmSelected(1);
    }
  });

  const handleInitComplete = useCallback(() => {
    void refresh();
    setCurrentScreen('home');
  }, [refresh]);

  const termWidth = columns - 2;
  const leftWidth = Math.floor(termWidth * 0.33);

  if (loading) {
    return (
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" width={termWidth}>
        <Header activeService={activeService} serviceRunning={serviceRunning} />
        <Box paddingX={3} paddingY={2}>
          <Text color="gray" dimColor>
            Chargement…
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" width={termWidth} height={serviceRunning ? rows : undefined}>
      <Header activeService={activeService} serviceRunning={serviceRunning} />

      {currentScreen === 'home' && (
        <HomeScreen
          leftWidth={leftWidth}
          options={options}
          isActive={!confirmExit}
          onNavigate={screen => setCurrentScreen(screen)}
        />
      )}

      {currentScreen === 'init' && (
        <InitScreen
          config={config}
          leftWidth={leftWidth}
          onComplete={handleInitComplete}
        />
      )}

      {currentScreen === 'odoo' && config && (
        <OdooScreen
          leftWidth={leftWidth}
          config={config}
          onBack={() => setCurrentScreen('home')}
          onConfigChange={() => void refresh()}
          onServiceRunning={svc => { setServiceRunning(true); setActiveService(svc); }}
          onServiceStopped={() => { setServiceRunning(false); setActiveService(null); }}
        />
      )}

      {currentScreen === 'config' && config && (
        <ConfigScreen
          config={config}
          leftWidth={leftWidth}
          onBack={() => setCurrentScreen('home')}
          onSaved={() => { void refresh(); setCurrentScreen('home'); }}
        />
      )}

      <ConfirmExit visible={confirmExit} selected={confirmSelected} />
    </Box>
  );
}
