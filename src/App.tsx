import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Screen, MenuOption, OdooServiceConfig, getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor, CliStartArgs } from './types/index.js';
import { useConfig } from './hooks/useConfig.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { Header } from './components/Header.js';
import { ConfirmExit } from './components/ConfirmExit.js';
import { HomeScreen } from './screens/HomeScreen.js';
import { InitScreen } from './screens/InitScreen.js';
import { OdooScreen } from './screens/OdooScreen.js';
import { ConfigScreen } from './screens/ConfigScreen.js';
import { DatabaseScreen } from './screens/DatabaseScreen.js';
import { IdeScreen } from './screens/IdeScreen.js';
import { UpdateScreen } from './screens/UpdateScreen.js';
import { checkForUpdate } from './services/updater.js';
import { patchConfig } from './services/config.js';

interface AppProps {
  onExit: () => void;
  onUpdate: () => void;
  startupArgs?: CliStartArgs;
}

export function App({ onExit, onUpdate, startupArgs }: AppProps) {
  const { columns, rows } = useTerminalSize();
  const { config, loading, refresh } = useConfig();
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [confirmExit, setConfirmExit] = useState(false);
  const [confirmSelected, setConfirmSelected] = useState(1);
  const [serviceRunning,  setServiceRunning]  = useState(false);
  const [activeService,   setActiveService]   = useState<OdooServiceConfig | null>(null);
  const [updateBanner,    setUpdateBanner]    = useState(false);
  const [updateConfirm,   setUpdateConfirm]   = useState(false);
  const [updateSel,       setUpdateSel]       = useState(1);
  const [showUpdate,      setShowUpdate]      = useState(false);

  // Reposition to top-left whenever the box height changes (service start/stop)
  useEffect(() => {
    process.stdout.write('\x1B[2J\x1B[H');
  }, [serviceRunning]);

  // Auto-navigate to odoo screen when CLI start args are present
  useEffect(() => {
    if (!loading && config?.initiated && startupArgs) {
      setCurrentScreen('odoo');
    }
  }, [loading, config?.initiated, startupArgs]);

  // Update check: show banner immediately if flagged, otherwise check in background
  useEffect(() => {
    if (loading) return;
    if (config?.to_update) {
      setUpdateBanner(true);
      return;
    }
    void checkForUpdate().then(hasUpdate => {
      if (!hasUpdate) return;
      void patchConfig({ to_update: true });
      setUpdateBanner(true);
    });
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const primaryColor = getPrimaryColor(config);
  const secondaryColor = getSecondaryColor(config);
  const textColor = getTextColor(config);
  const cursorColor = getCursorColor(config);

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
          id: 'database',
          label: 'Base de Données',
          description: 'Gérer les bases de données : restauration depuis un dump .zip.',
          screen: 'database' as Screen,
          visible: config?.initiated === true,
        },
        {
          id: 'ide',
          label: 'IDE',
          description: 'Ouvrir une version Odoo dans VS Code avec la configuration de débogage.',
          screen: 'ide' as Screen,
          visible: config?.initiated === true,
        },
        {
          id: 'config',
          label: 'Paramètres',
          description: 'Changer la configuration nupo : modifiez les paramètres de votre environnement.',
          screen: 'config' as Screen,
          visible: config?.initiated === true,
        },
      ].filter(o => o.visible),
    [config],
  );

  // Global input: handles Ctrl+C, Ctrl+U and confirm dialogs on all screens
  useInput((char, key) => {
    if (updateConfirm) {
      if (key.leftArrow)  setUpdateSel(0);
      if (key.rightArrow) setUpdateSel(1);
      if (key.return) {
        if (updateSel === 0) { setUpdateConfirm(false); setShowUpdate(true); }
        else { setUpdateConfirm(false); setUpdateSel(1); }
      }
      if (key.escape || char === 'n') { setUpdateConfirm(false); setUpdateSel(1); }
      if (char === 'o' || char === 'y') { setUpdateConfirm(false); setShowUpdate(true); }
      return;
    }

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

    if (key.ctrl && char === 'u' && updateBanner) {
      setUpdateConfirm(true);
      setUpdateSel(1);
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
      <Box borderStyle="round" borderColor={primaryColor} flexDirection="column" width={termWidth}>
        <Header activeService={activeService} serviceRunning={serviceRunning} primaryColor={primaryColor} secondaryColor={secondaryColor} />
        <Box paddingX={3} paddingY={2}>
          <Text color={textColor} dimColor>
            Chargement…
          </Text>
        </Box>
      </Box>
    );
  }

  if (showUpdate) {
    return (
      <UpdateScreen
        termWidth={termWidth}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        textColor={textColor}
        onComplete={onUpdate}
        onError={() => setShowUpdate(false)}
      />
    );
  }

  return (
    <Box borderStyle="round" borderColor={primaryColor} flexDirection="column" width={termWidth} height={serviceRunning ? rows : undefined}>
      <Header activeService={activeService} serviceRunning={serviceRunning} primaryColor={primaryColor} secondaryColor={secondaryColor} />

      {updateBanner && (
        <Box paddingX={3} paddingY={0} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderColor={secondaryColor}>
          <Text color={secondaryColor}>{'⬆ '}</Text>
          <Text color={textColor}>Mise à jour disponible — </Text>
          <Text color={secondaryColor} bold>Ctrl+U</Text>
          <Text color={textColor}> pour mettre à jour</Text>
        </Box>
      )}

      {currentScreen === 'home' && (
        <HomeScreen
          leftWidth={leftWidth}
          options={options}
          isActive={!confirmExit}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          textColor={textColor}
          cursorColor={cursorColor}
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
          autoStart={startupArgs}
        />
      )}

      {currentScreen === 'database' && config && (
        <DatabaseScreen
          config={config}
          leftWidth={leftWidth}
          onBack={() => setCurrentScreen('home')}
        />
      )}

      {currentScreen === 'ide' && config && (
        <IdeScreen
          config={config}
          leftWidth={leftWidth}
          onBack={() => setCurrentScreen('home')}
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

      <ConfirmExit visible={confirmExit} selected={confirmSelected} textColor={textColor} cursorColor={cursorColor} />

      {updateConfirm && (
        <Box paddingX={3} paddingY={0} borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor={secondaryColor}>
          <Text color={secondaryColor}>Mettre à jour et redémarrer nupo ? </Text>
          <Text color={updateSel === 0 ? 'black' : textColor} backgroundColor={updateSel === 0 ? secondaryColor : undefined} bold={updateSel === 0}>{' Oui '}</Text>
          <Text>  </Text>
          <Text color={updateSel === 1 ? 'black' : textColor} backgroundColor={updateSel === 1 ? cursorColor : undefined} bold={updateSel === 1}>{' Non '}</Text>
        </Box>
      )}
    </Box>
  );
}
