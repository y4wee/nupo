import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PathInput } from '../components/PathInput.js';
import { access } from 'fs/promises';
import { NupoConfig } from '../types/index.js';
import { patchConfig } from '../services/config.js';
import { LeftPanel } from '../components/LeftPanel.js';

interface ConfigParam {
  key: keyof NupoConfig;
  label: string;
  description: string;
  validate?: (value: string) => Promise<string | null>; // null = ok, string = error message
}

const PARAMS: ConfigParam[] = [
  {
    key: 'odoo_path_repo',
    label: 'Chemin du dépôt Odoo',
    description: 'Chemin absolu vers le dépôt Odoo sur ce système.',
    validate: async (value: string) => {
      const v = value.trim();
      if (!v) return 'Le chemin ne peut pas être vide.';
      try {
        await access(v);
        return null;
      } catch {
        return `Chemin introuvable : ${v}`;
      }
    },
  },
];

type EditState =
  | { active: false }
  | { active: true; paramIndex: number; value: string; error: string | null; saving: boolean };

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
      if (key.upArrow) setSelected(prev => (prev - 1 + PARAMS.length) % PARAMS.length);
      if (key.downArrow) setSelected(prev => (prev + 1) % PARAMS.length);
      if (key.return) {
        const param = PARAMS[selected]!;
        setEdit({
          active: true,
          paramIndex: selected,
          value: String(config[param.key] ?? ''),
          error: null,
          saving: false,
        });
      }
      if (key.escape) onBack();
    },
    { isActive: !(edit.active && edit.saving) },
  );

  const handleSubmit = async (inputValue: string) => {
    if (!edit.active) return;
    const param = PARAMS[edit.paramIndex]!;
    const trimmed = inputValue.trim();

    setEdit(prev => (prev.active ? { ...prev, saving: true, error: null } : prev));

    const error = param.validate ? await param.validate(trimmed) : null;

    if (error) {
      setEdit(prev => (prev.active ? { ...prev, saving: false, error } : prev));
      return;
    }

    await patchConfig({ [param.key]: trimmed });
    setEdit({ active: false });
    onSaved();
  };

  const currentParam = PARAMS[selected]!;

  return (
    <Box flexDirection="row">
      <LeftPanel width={leftWidth} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color="cyan" bold>
          Configuration
        </Text>

        {/* Description de la sélection courante */}
        {!edit.active && (
          <Box borderStyle="round" borderColor="gray" paddingX={1} paddingY={0}>
            <Text color="gray" wrap="wrap">
              {currentParam.description}
            </Text>
          </Box>
        )}

        {/* Liste des paramètres */}
        {!edit.active && (
          <Box flexDirection="column" marginTop={1} gap={0}>
            {PARAMS.map((param, i) => {
              const isSelected = i === selected;
              const value = String(config[param.key] ?? '');
              return (
                <Box key={param.key} flexDirection="row" gap={1}>
                  <Text
                    color={isSelected ? 'black' : 'white'}
                    backgroundColor={isSelected ? 'cyan' : undefined}
                    bold={isSelected}
                  >
                    {` ${isSelected ? '▶' : ' '} ${param.label}`}
                  </Text>
                  <Text color="gray" dimColor>
                    {value || '(non défini)'}
                  </Text>
                </Box>
              );
            })}
          </Box>
        )}

        {/* Zone d'édition */}
        {edit.active && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="white">{PARAMS[edit.paramIndex]!.label} :</Text>
            <Box>
              <Text color="gray" dimColor>
                {'› '}
              </Text>
              <PathInput
                value={edit.value}
                onChange={value =>
                  setEdit(prev => (prev.active ? { ...prev, value, error: null } : prev))
                }
                onSubmit={val => void handleSubmit(val)}
                focus={!edit.saving}
              />
            </Box>
            {edit.error && (
              <Text color="red">{edit.error}</Text>
            )}
            {edit.saving && (
              <Text color="yellow" dimColor>
                Sauvegarde…
              </Text>
            )}
          </Box>
        )}

        {/* Aide */}
        <Box marginTop={1}>
          {edit.active ? (
            <Text color="gray" dimColor>
              {'↵ sauvegarder  ·  Échap annuler'}
            </Text>
          ) : (
            <Text color="gray" dimColor>
              {'↑↓ naviguer  ·  ↵ modifier  ·  Échap retour'}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
