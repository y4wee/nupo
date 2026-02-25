import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PathInput } from '../components/PathInput.js';
import { access } from 'fs/promises';
import { NupoConfig } from '../types/index.js';
import { patchConfig, ensureBaseConf, getBaseConfPath } from '../services/config.js';
import { openInEditor } from '../services/system.js';
import { LeftPanel } from '../components/LeftPanel.js';

// ── Item types ────────────────────────────────────────────────────────────────

type ConfigItem =
  | {
      type: 'config';
      key: keyof NupoConfig;
      label: string;
      description: string;
      validate?: (value: string) => Promise<string | null>;
    }
  | {
      type: 'action';
      id: string;
      label: string;
      description: string;
    };

const ITEMS: ConfigItem[] = [
  {
    type: 'config',
    key: 'odoo_path_repo',
    label: 'Chemin du dépôt Odoo',
    description: 'Chemin absolu vers le dépôt Odoo sur ce système.',
    validate: async (value: string) => {
      const v = value.trim();
      if (!v) return 'Le chemin ne peut pas être vide.';
      try { await access(v); return null; }
      catch { return `Chemin introuvable : ${v}`; }
    },
  },
  {
    type: 'action',
    id: 'open_base_conf',
    label: 'Conf Odoo de base',
    description: `Template de configuration utilisé lors de la création des services Odoo.\nFichier : ${getBaseConfPath()}`,
  },
];

type EditState =
  | { active: false }
  | { active: true; itemIndex: number; value: string; error: string | null; saving: boolean };

interface ConfigScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
  onSaved: () => void;
}

export function ConfigScreen({ config, leftWidth, onBack, onSaved }: ConfigScreenProps) {
  const [selected, setSelected] = useState(0);
  const [edit, setEdit] = useState<EditState>({ active: false });

  useInput(
    (_char, key) => {
      if (edit.active) {
        if (key.escape) setEdit({ active: false });
        return;
      }
      if (key.upArrow)   setSelected(prev => (prev - 1 + ITEMS.length) % ITEMS.length);
      if (key.downArrow) setSelected(prev => (prev + 1) % ITEMS.length);
      if (key.return) {
        const item = ITEMS[selected]!;
        if (item.type === 'config') {
          setEdit({
            active: true,
            itemIndex: selected,
            value: String(config[item.key] ?? ''),
            error: null,
            saving: false,
          });
        } else if (item.type === 'action' && item.id === 'open_base_conf') {
          void ensureBaseConf().then(() => {
            openInEditor(getBaseConfPath());
          });
        }
      }
      if (key.escape) onBack();
    },
    { isActive: !(edit.active && (edit as { saving?: boolean }).saving) },
  );

  const handleSubmit = async (inputValue: string) => {
    if (!edit.active) return;
    const item = ITEMS[edit.itemIndex]!;
    if (item.type !== 'config') return;
    const trimmed = inputValue.trim();

    setEdit(prev => (prev.active ? { ...prev, saving: true, error: null } : prev));

    const error = item.validate ? await item.validate(trimmed) : null;
    if (error) {
      setEdit(prev => (prev.active ? { ...prev, saving: false, error } : prev));
      return;
    }

    await patchConfig({ [item.key]: trimmed });
    setEdit({ active: false });
    onSaved();
  };

  const currentItem = ITEMS[selected]!;

  return (
    <Box flexDirection="row">
      <LeftPanel width={leftWidth} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color="cyan" bold>Configuration</Text>

        {/* Description */}
        {!edit.active && (
          <Box borderStyle="round" borderColor="gray" paddingX={1} paddingY={0}>
            <Text color="gray" wrap="wrap">{currentItem.description}</Text>
          </Box>
        )}

        {/* Liste */}
        {!edit.active && (
          <Box flexDirection="column" marginTop={1} gap={0}>
            {ITEMS.map((item, i) => {
              const isSel = i === selected;
              const value = item.type === 'config'
                ? (String(config[item.key] ?? '') || '(non défini)')
                : '↵ ouvrir dans $EDITOR';
              return (
                <Box key={item.type === 'config' ? item.key : item.id} flexDirection="row" gap={1}>
                  <Text
                    color={isSel ? 'black' : 'white'}
                    backgroundColor={isSel ? 'cyan' : undefined}
                    bold={isSel}
                  >
                    {` ${isSel ? '▶' : ' '} ${item.label}`}
                  </Text>
                  <Text color="gray" dimColor>{value}</Text>
                </Box>
              );
            })}
          </Box>
        )}

        {/* Édition */}
        {edit.active && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="white">
              {(ITEMS[edit.itemIndex] as Extract<ConfigItem, { type: 'config' }>).label} :
            </Text>
            <Box>
              <Text color="gray" dimColor>{'› '}</Text>
              <PathInput
                value={edit.value}
                onChange={value => setEdit(prev => (prev.active ? { ...prev, value, error: null } : prev))}
                onSubmit={val => void handleSubmit(val)}
                focus={!(edit as { saving?: boolean }).saving}
              />
            </Box>
            {edit.error   && <Text color="red">{edit.error}</Text>}
            {(edit as { saving?: boolean }).saving && <Text color="yellow" dimColor>Sauvegarde…</Text>}
          </Box>
        )}

        {/* Aide */}
        <Box marginTop={1}>
          {edit.active ? (
            <Text color="gray" dimColor>↵ sauvegarder  ·  Échap annuler</Text>
          ) : (
            <Text color="gray" dimColor>↑↓ naviguer  ·  ↵ modifier  ·  Échap retour</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
