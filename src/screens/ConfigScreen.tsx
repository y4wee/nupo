import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PathInput } from '../components/PathInput.js';
import { access } from 'fs/promises';
import { NupoConfig, getPrimaryColor, getSecondaryColor, getTextColor } from '../types/index.js';
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
      transform?: (value: string) => unknown;
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
    type: 'config',
    key: 'log_buffer_size',
    label: 'Buffer de logs',
    description: 'Nombre de lignes de logs conservées en mémoire lors de l\'exécution d\'un service Odoo. Valeur recommandée : 500–5000.',
    validate: async (value: string) => {
      const n = parseInt(value.trim(), 10);
      if (isNaN(n) || n < 100) return 'Doit être un entier ≥ 100.';
      return null;
    },
    transform: (value: string) => parseInt(value.trim(), 10),
  },
  {
    type: 'config',
    key: 'primary_color',
    label: 'Couleur principale',
    description: 'Couleur principale de l\'interface nupo (logo, accents). Format hexadécimal : #RRGGBB.',
    validate: async (value: string) => {
      if (!/^#[0-9a-fA-F]{6}$/.test(value.trim())) return 'Format invalide. Exemple : #9F0C58';
      return null;
    },
  },
  {
    type: 'config',
    key: 'secondary_color',
    label: 'Couleur secondaire',
    description: 'Couleur secondaire de l\'interface nupo (titres des écrans). Format hexadécimal : #RRGGBB.',
    validate: async (value: string) => {
      if (!/^#[0-9a-fA-F]{6}$/.test(value.trim())) return 'Format invalide. Exemple : #E79439';
      return null;
    },
  },
  {
    type: 'config',
    key: 'text_color',
    label: 'Couleur des textes',
    description: 'Couleur des textes secondaires de l\'interface nupo (hints, valeurs, labels). Format hexadécimal : #RRGGBB.',
    validate: async (value: string) => {
      if (!/^#[0-9a-fA-F]{6}$/.test(value.trim())) return 'Format invalide. Exemple : #848484';
      return null;
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
  const textColor = getTextColor(config);
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

    const value = item.transform ? item.transform(trimmed) : trimmed;
    await patchConfig({ [item.key]: value } as Partial<NupoConfig>);
    setEdit({ active: false });
    onSaved();
  };

  const currentItem = ITEMS[selected]!;

  return (
    <Box flexDirection="row">
      <LeftPanel width={leftWidth} primaryColor={getPrimaryColor(config)} textColor={textColor} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={getSecondaryColor(config)} bold>Paramètres</Text>

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
                  <Text color={textColor} dimColor>{value}</Text>
                  {item.type === 'config' && item.key.endsWith('_color') && config[item.key] && (
                    <Text color={String(config[item.key])}>●</Text>
                  )}
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
              <Text color={textColor} dimColor>{'› '}</Text>
              <PathInput
                value={edit.value}
                onChange={value => setEdit(prev => (prev.active ? { ...prev, value, error: null } : prev))}
                onSubmit={val => void handleSubmit(val)}
                focus={!(edit as { saving?: boolean }).saving}
                textColor={textColor}
              />
            </Box>
            {(ITEMS[edit.itemIndex] as Extract<ConfigItem, { type: 'config' }>)?.key?.endsWith('_color') && /^#[0-9a-fA-F]{6}$/.test(edit.value.trim()) && (
              <Text><Text color={edit.value.trim()}>● </Text><Text color={textColor} dimColor>{edit.value.trim()}</Text></Text>
            )}
            {edit.error   && <Text color="red">{edit.error}</Text>}
            {(edit as { saving?: boolean }).saving && <Text color="yellow" dimColor>Sauvegarde…</Text>}
          </Box>
        )}

        {/* Aide */}
        <Box marginTop={1}>
          {edit.active ? (
            <Text color={textColor} dimColor>↵ sauvegarder  ·  Échap annuler</Text>
          ) : (
            <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ modifier  ·  Échap retour</Text>
          )}
        </Box>

        {/* Description */}
        {!edit.active && (
          <Box borderStyle="round" borderColor={getSecondaryColor(config)} paddingX={1} paddingY={0}>
            <Text color={textColor} wrap="wrap">{currentItem.description}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
