import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { join } from 'path';
import { NupoConfig, OdooServiceConfig } from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { runInTerminal } from '../services/system.js';

interface StartServiceScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
}

type Step = 'select' | 'args_list' | 'input_db' | 'input_module' | 'confirm';

const ARGS_ITEMS = [
  { key: 'shell'           as const, label: 'shell',             type: 'toggle' as const },
  { key: 'db'              as const, label: '-d <database>',     type: 'input'  as const },
  { key: 'module'          as const, label: '-u <module>',       type: 'input'  as const },
  { key: 'stop_after_init' as const, label: '--stop-after-init', type: 'toggle' as const },
  { key: 'launch'          as const, label: 'Lancer →',          type: 'action' as const },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildAddonsPaths(service: OdooServiceConfig): string[] {
  const paths = [join(service.versionPath, 'community', 'addons')];
  if (service.useEnterprise) paths.push(join(service.versionPath, 'enterprise'));
  for (const f of service.customFolders) paths.push(join(service.versionPath, 'custom', f));
  return paths;
}

function buildLaunchCmd(
  service: OdooServiceConfig,
  opts: { shell: boolean; db: string; module: string; stopAfterInit: boolean },
): { cmd: string; args: string[] } {
  const python   = join(service.versionPath, 'venv', 'bin', 'python3');
  const odooBin  = join(service.versionPath, 'community', 'odoo-bin');
  const args: string[] = [odooBin];

  if (opts.shell) args.push('shell');
  args.push('-c', service.confPath);
  args.push('--addons-path', buildAddonsPaths(service).join(','));
  if (opts.db)            args.push('-d', opts.db);
  if (opts.module)        args.push('-u', opts.module);
  if (opts.stopAfterInit) args.push('--stop-after-init');

  return { cmd: python, args };
}

// ── Component ────────────────────────────────────────────────────────────────

export function StartServiceScreen({ config, leftWidth, onBack }: StartServiceScreenProps) {
  const services = Object.values(config.odoo_services ?? {});

  const [step,       setStep]      = useState<Step>('select');
  const [selected,   setSelected]  = useState(0);
  const [argsCursor, setArgsCursor] = useState(0);

  const [useShell,      setUseShell]      = useState(false);
  const [dbName,        setDbName]        = useState('');
  const [moduleName,    setModuleName]    = useState('');
  const [stopAfterInit, setStopAfterInit] = useState(false);
  const [inputValue,    setInputValue]    = useState('');

  const service = services[selected] as OdooServiceConfig | undefined;
  const warnNoDb = !!moduleName && !dbName;

  // ── select ────────────────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { onBack(); return; }
    if (services.length === 0) return;
    if (key.upArrow)   setSelected(p => Math.max(0, p - 1));
    if (key.downArrow) setSelected(p => Math.min(services.length - 1, p + 1));
    if (key.return && service) setStep('args_list');
  }, { isActive: step === 'select' });

  // ── args_list ─────────────────────────────────────────────────────────────

  useInput((char, key) => {
    if (key.escape) { setStep('select'); return; }
    if (key.upArrow)   setArgsCursor(p => Math.max(0, p - 1));
    if (key.downArrow) setArgsCursor(p => Math.min(ARGS_ITEMS.length - 1, p + 1));

    const activated = key.return || char === ' ';
    if (activated) {
      const item = ARGS_ITEMS[argsCursor]!;
      switch (item.key) {
        case 'shell':           setUseShell(p => !p); break;
        case 'stop_after_init': setStopAfterInit(p => !p); break;
        case 'db':     setInputValue(dbName);     setStep('input_db');     break;
        case 'module': setInputValue(moduleName); setStep('input_module'); break;
        case 'launch': setStep('confirm'); break;
      }
    }
  }, { isActive: step === 'args_list' });

  // ── input_db ──────────────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) setStep('args_list');
  }, { isActive: step === 'input_db' });

  // ── input_module ──────────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) setStep('args_list');
  }, { isActive: step === 'input_module' });

  // ── confirm ───────────────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { setStep('args_list'); return; }
    if (key.return && service) {
      const { cmd, args } = buildLaunchCmd(service, {
        shell: useShell, db: dbName, module: moduleName, stopAfterInit,
      });
      runInTerminal(cmd, args);
    }
  }, { isActive: step === 'confirm' });

  // ── render helpers ────────────────────────────────────────────────────────

  const argIsSet: Record<string, boolean> = {
    shell:           useShell,
    db:              !!dbName,
    module:          !!moduleName,
    stop_after_init: stopAfterInit,
  };

  const argDisplay: Record<string, string> = {
    db:     dbName,
    module: moduleName,
  };

  const launchCmd = step === 'confirm' && service
    ? buildLaunchCmd(service, { shell: useShell, db: dbName, module: moduleName, stopAfterInit })
    : null;

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="row" flexGrow={1}>
      <LeftPanel width={leftWidth} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color="cyan" bold>Démarrer Service Odoo</Text>

        {/* ── select ── */}
        {step === 'select' && services.length === 0 && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="yellow">Aucun service configuré.</Text>
            <Text color="gray" dimColor>
              Créez d'abord un service via « Configurer Service Odoo ».
            </Text>
            <Box marginTop={1}>
              <Text color="gray" dimColor>Échap retour</Text>
            </Box>
          </Box>
        )}

        {step === 'select' && services.length > 0 && (
          <Box flexDirection="column" gap={0} marginTop={1}>
            {services.map((svc, i) => {
              const isSel = i === selected;
              return (
                <Text
                  key={svc.name}
                  color={isSel ? 'black' : 'white'}
                  backgroundColor={isSel ? 'cyan' : undefined}
                  bold={isSel}
                >
                  {` ${isSel ? '▶' : ' '} ${svc.name}  `}
                  <Text color={isSel ? 'black' : 'gray'} dimColor={!isSel}>
                    {svc.branch}{svc.useEnterprise ? ' · Enterprise' : ''}
                  </Text>
                </Text>
              );
            })}
            <Box marginTop={1}>
              <Text color="gray" dimColor>↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour</Text>
            </Box>
          </Box>
        )}

        {/* ── args_list ── */}
        {step === 'args_list' && (
          <Box flexDirection="column" gap={0} marginTop={1}>
            <Text color="white">Arguments supplémentaires :</Text>
            <Box flexDirection="column" gap={0} marginTop={1}>
              {ARGS_ITEMS.map((item, i) => {
                const isSel    = i === argsCursor;
                const isAction = item.type === 'action';
                const isSet    = argIsSet[item.key] ?? false;
                const display  = argDisplay[item.key] ?? '';
                return (
                  <Box key={item.key} flexDirection="row" gap={1}>
                    {isAction ? (
                      <Text
                        color={isSel ? 'black' : 'green'}
                        backgroundColor={isSel ? 'green' : undefined}
                        bold
                      >
                        {` ${isSel ? '▶' : ' '} ${item.label}`}
                      </Text>
                    ) : (
                      <>
                        <Text
                          color={isSel ? 'black' : 'white'}
                          backgroundColor={isSel ? 'cyan' : undefined}
                          bold={isSel}
                        >
                          {` ${isSel ? '▶' : ' '} ${isSet ? '[✓]' : '[ ]'} ${item.label}`}
                        </Text>
                        {display && <Text color="cyan">{display}</Text>}
                      </>
                    )}
                  </Box>
                );
              })}
            </Box>
            {warnNoDb && (
              <Box marginTop={1}>
                <Text color="yellow">⚠  -u nécessite un -d (base de données non définie)</Text>
              </Box>
            )}
            <Box marginTop={1}>
              <Text color="gray" dimColor>
                ↑↓ naviguer  ·  ↵/Espace basculer  ·  Échap retour
              </Text>
            </Box>
          </Box>
        )}

        {/* ── input_db ── */}
        {step === 'input_db' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="white">Base de données (-d) :</Text>
            <Box>
              <Text color="gray" dimColor>{'› '}</Text>
              <TextInput
                value={inputValue}
                onChange={setInputValue}
                onSubmit={v => { setDbName(v.trim()); setStep('args_list'); }}
                placeholder="ma_base"
              />
            </Box>
            <Text color="gray" dimColor>↵ valider  ·  Échap retour</Text>
          </Box>
        )}

        {/* ── input_module ── */}
        {step === 'input_module' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="white">Module à mettre à jour (-u) :</Text>
            <Box>
              <Text color="gray" dimColor>{'› '}</Text>
              <TextInput
                value={inputValue}
                onChange={setInputValue}
                onSubmit={v => { setModuleName(v.trim()); setStep('args_list'); }}
                placeholder="mon_module"
              />
            </Box>
            <Text color="gray" dimColor>↵ valider  ·  Échap retour</Text>
          </Box>
        )}

        {/* ── confirm ── */}
        {step === 'confirm' && launchCmd && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="white">Commande de lancement :</Text>
            <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
              <Text color="cyan">{launchCmd.cmd}</Text>
              {launchCmd.args.map((arg, i) => (
                <Text key={i} color="cyan" dimColor={i > 0}>{'  ' + arg}</Text>
              ))}
            </Box>
            {warnNoDb && (
              <Text color="yellow">⚠  -u nécessite un -d (base de données non définie)</Text>
            )}
            <Box marginTop={1}>
              <Text color="gray" dimColor>↵ lancer  ·  Échap retour</Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
