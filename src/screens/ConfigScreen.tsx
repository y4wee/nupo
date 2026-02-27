import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { PathInput } from '../components/PathInput.js';
import { access } from 'fs/promises';
import { NupoConfig, getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor } from '../types/index.js';
import { patchConfig, ensureBaseConf, getBaseConfPath } from '../services/config.js';
import { openInEditor, copyToClipboard } from '../services/system.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { checkSSH, generateSSHKey, verifySSHKey, addSSHConfig, readSSHPublicKey, getActiveSSHKeyPath } from '../services/checks.js';

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
    key: 'cursor_color',
    label: 'Couleur du curseur',
    description: 'Couleur de surlignage des éléments sélectionnés dans les listes. Format hexadécimal ou nom CSS : #RRGGBB ou cyan.',
    validate: async (value: string) => {
      if (!value.trim()) return 'La valeur ne peut pas être vide.';
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
  {
    type: 'action',
    id: 'ssh_github',
    label: 'SSH GitHub',
    description: 'Tester ou configurer la connexion SSH GitHub utilisée pour cloner les dépôts privés.',
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

type SshPhase = 'checking' | 'success' | 'choice' | 'generating' | 'instructions' | 'verifying';

export function ConfigScreen({ config, leftWidth, onBack, onSaved }: ConfigScreenProps) {
  const textColor = getTextColor(config);
  const cursorColor = getCursorColor(config);
  const [selected, setSelected] = useState(0);
  const [edit, setEdit] = useState<EditState>({ active: false });

  // SSH sub-flow
  const [sshPhase, setSshPhase]   = useState<SshPhase | null>(null);
  const [sshChoice, setSshChoice] = useState<0 | 1>(0);
  const [sshPubKey, setSshPubKey] = useState('');
  const [sshKeyPath, setSshKeyPath] = useState('');
  const [sshError, setSshError]   = useState<string | null>(null);
  const [sshCopied, setSshCopied] = useState(false);

  const startSSHCheck = useCallback(async () => {
    setSshPhase('checking');
    const result = await checkSSH();
    if (result.ok) {
      const keyPath = await getActiveSSHKeyPath();
      const pubKey = await readSSHPublicKey(keyPath);
      if (pubKey) setSshPubKey(pubKey);
      setSshCopied(false);
      setSshPhase('success');
    } else {
      setSshPhase('choice');
      setSshChoice(0);
    }
  }, []);

  const runSSHSetup = useCallback(async () => {
    setSshPhase('generating');
    const result = await generateSSHKey();
    if (!result.ok || !result.publicKey || !result.keyPath) {
      setSshPhase('choice');
      setSshError(result.error ?? 'Erreur lors de la génération de la clé.');
      return;
    }
    setSshPubKey(result.publicKey);
    setSshKeyPath(result.keyPath);
    setSshError(null);
    setSshCopied(false);
    setSshPhase('instructions');
  }, []);

  const runSSHVerify = useCallback(async (keyPath: string) => {
    setSshPhase('verifying');
    setSshError(null);
    const result = await verifySSHKey(keyPath);
    if (result.ok) {
      await addSSHConfig(keyPath);
      await patchConfig({ ssh_configured: true });
      onSaved();
      setSshPhase('success');
    } else {
      setSshError('Clé non reconnue par GitHub. Vérifiez que vous avez bien ajouté la clé.');
      setSshPhase('instructions');
    }
  }, [onSaved]);

  useInput(
    (_char, key) => {
      if (edit.active) {
        if (key.escape) setEdit({ active: false });
        return;
      }
      // SSH choice navigation
      if (sshPhase === 'choice') {
        if (key.leftArrow || key.rightArrow) setSshChoice(c => (c === 0 ? 1 : 0));
        if (key.return) {
          if (sshChoice === 1) { void runSSHSetup(); }
          else { setSshPhase(null); }
        }
        if (key.escape) setSshPhase(null);
        return;
      }
      // SSH instructions: C copies key, Enter = verify
      if (sshPhase === 'instructions') {
        if (_char === 'c' && sshPubKey) {
          const ok = copyToClipboard(sshPubKey);
          if (ok) setSshCopied(true);
        } else if (key.return) {
          void runSSHVerify(sshKeyPath);
        } else if (key.escape) {
          setSshPhase(null);
        }
        return;
      }
      // SSH success: C copies key, anything else returns to list
      if (sshPhase === 'success') {
        if (_char === 'c' && sshPubKey) {
          const ok = copyToClipboard(sshPubKey);
          if (ok) setSshCopied(true);
        } else {
          setSshPhase(null);
          setSshPubKey('');
        }
        return;
      }
      if (sshPhase !== null) return; // checking / generating / verifying: block input

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
        } else if (item.type === 'action' && item.id === 'ssh_github') {
          void startSSHCheck();
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
        {!edit.active && sshPhase === null && (
          <Box flexDirection="column" marginTop={1} gap={0}>
            {ITEMS.map((item, i) => {
              const isSel = i === selected;
              let value: string;
              if (item.type === 'config') {
                value = String(config[item.key] ?? '') || '(non défini)';
              } else if (item.id === 'ssh_github') {
                value = config.ssh_configured ? '✓ configurée' : '↵ tester';
              } else {
                value = '↵ ouvrir dans $EDITOR';
              }
              return (
                <Box key={item.type === 'config' ? item.key : item.id} flexDirection="row" gap={1}>
                  <Text
                    color={isSel ? 'black' : 'white'}
                    backgroundColor={isSel ? cursorColor : undefined}
                    bold={isSel}
                  >
                    {` ${isSel ? '▶' : ' '} ${item.label}`}
                  </Text>
                  <Text
                    color={item.type === 'action' && item.id === 'ssh_github' && config.ssh_configured ? 'green' : textColor}
                    dimColor={!(item.type === 'action' && item.id === 'ssh_github' && config.ssh_configured)}
                  >
                    {value}
                  </Text>
                  {item.type === 'config' && item.key.endsWith('_color') && config[item.key] && (
                    <Text color={String(config[item.key])}>●</Text>
                  )}
                </Box>
              );
            })}
          </Box>
        )}

        {/* SSH flow */}
        {sshPhase !== null && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            {sshPhase === 'checking' && (
              <Text color={textColor} dimColor>⟳ Test de la connexion SSH GitHub…</Text>
            )}

            {sshPhase === 'success' && (
              <Box flexDirection="column" gap={1}>
                <Text color="green" bold>✓ Connexion SSH GitHub opérationnelle</Text>
                {sshPubKey ? (
                  <Box flexDirection="column" gap={0}>
                    <Text color={getSecondaryColor(config)}>Clé publique :</Text>
                    <Text color="cyan">{sshPubKey}</Text>
                    {sshCopied
                      ? <Text color="green">✓ Copié dans le presse-papier !</Text>
                      : <Text color={textColor} dimColor>C copier la clé  ·  toute autre touche pour revenir</Text>
                    }
                  </Box>
                ) : (
                  <Text color={textColor} dimColor>toute touche pour revenir</Text>
                )}
              </Box>
            )}

            {sshPhase === 'choice' && (
              <Box flexDirection="column" gap={1}>
                <Text color="white">Connexion SSH GitHub non configurée.</Text>
                <Text color={textColor}>Voulez-vous configurer une clé SSH ?</Text>
                {sshError && <Text color="red">{sshError}</Text>}
                <Box gap={2}>
                  <Text
                    color={sshChoice === 0 ? 'black' : textColor}
                    backgroundColor={sshChoice === 0 ? getCursorColor(config) : undefined}
                    bold={sshChoice === 0}
                  >{' Non '}</Text>
                  <Text
                    color={sshChoice === 1 ? 'black' : textColor}
                    backgroundColor={sshChoice === 1 ? getCursorColor(config) : undefined}
                    bold={sshChoice === 1}
                  >{' Oui '}</Text>
                </Box>
                <Text color={textColor} dimColor>◀▶ choisir  ·  ↵ confirmer  ·  Échap annuler</Text>
              </Box>
            )}

            {sshPhase === 'generating' && (
              <Text color={textColor} dimColor>⟳ Génération de la clé SSH…</Text>
            )}

            {(sshPhase === 'instructions' || sshPhase === 'verifying') && (
              <Box flexDirection="column" gap={1}>
                <Text color="white" bold>Clé SSH générée : <Text color={textColor} bold={false}>{sshKeyPath}.pub</Text></Text>
                <Box flexDirection="column" gap={0}>
                  <Text color={getSecondaryColor(config)}>Copiez cette clé publique :</Text>
                  <Text color="cyan">{sshPubKey}</Text>
                  {sshCopied
                    ? <Text color="green">✓ Copié dans le presse-papier !</Text>
                    : <Text color={textColor} dimColor>C copier la clé</Text>
                  }
                </Box>
                <Box flexDirection="column" gap={0}>
                  <Text color="white">Puis ajoutez-la sur GitHub :</Text>
                  <Text color={textColor} dimColor>  1. github.com → Settings → SSH and GPG keys</Text>
                  <Text color={textColor} dimColor>  2. New SSH key → collez la clé → Save</Text>
                </Box>
                {sshError && <Text color="red">{sshError}</Text>}
                {sshPhase === 'verifying'
                  ? <Text color={textColor} dimColor>⟳ Vérification en cours…</Text>
                  : <Text color={textColor} dimColor>↵ Vérifier la connexion une fois la clé ajoutée  ·  Échap annuler</Text>
                }
              </Box>
            )}
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
            {(() => {
              const editItem = ITEMS[edit.itemIndex] as Extract<ConfigItem, { type: 'config' }>;
              const val = edit.value.trim();
              const isColorKey = editItem?.key?.endsWith('_color');
              const isHex = /^#[0-9a-fA-F]{6}$/.test(val);
              const isCursorKey = editItem?.key === 'cursor_color';
              return isColorKey && (isHex || (isCursorKey && val.length > 0)) ? (
                <Text><Text color={val}>● </Text><Text color={textColor} dimColor>{val}</Text></Text>
              ) : null;
            })()}
            {edit.error   && <Text color="red">{edit.error}</Text>}
            {(edit as { saving?: boolean }).saving && <Text color="yellow" dimColor>Sauvegarde…</Text>}
          </Box>
        )}

        {/* Aide */}
        {sshPhase === null && (
          <Box marginTop={1}>
            {edit.active ? (
              <Text color={textColor} dimColor>↵ sauvegarder  ·  Échap annuler</Text>
            ) : (
              <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ modifier  ·  Échap retour</Text>
            )}
          </Box>
        )}

        {/* Description */}
        {!edit.active && sshPhase === null && (
          <Box borderStyle="round" borderColor={textColor} paddingX={1} paddingY={0}>
            <Text color={textColor} wrap="wrap">{currentItem.description}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
