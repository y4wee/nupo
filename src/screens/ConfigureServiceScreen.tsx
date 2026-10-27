import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { mkdir, writeFile, unlink, access, rename } from 'fs/promises';
import { join, basename } from 'path';
import { NupoConfig, OdooVersion, OdooServiceConfig, getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor, sortedOdooVersions } from '../types/index.js';
import { readConfig, writeConfig, readBaseConf } from '../services/config.js';
import { openInEditor } from '../services/system.js';
import { dirExists, findMissingCustomPath, buildServiceConfig } from '../services/odoo.js';
import { LeftPanel } from '../components/LeftPanel.js';

interface ConfigureServiceScreenProps {
  config: NupoConfig;
  leftWidth: number;
  initialService?: OdooServiceConfig;
  onComplete: () => void;
  onBack: () => void;
  onParamSaved?: (service: OdooServiceConfig) => void;
}

// ── Step type ────────────────────────────────────────────────────────────────
// 'edit_list' = param selection screen shown in edit mode
type Step = 'edit_list' | 'name' | 'version' | 'custom_path' | 'saving' | 'done' | 'confirm_delete';

const EDIT_PARAMS = [
  { key: 'name'        as const, label: 'Nom' },
  { key: 'custom_path' as const, label: 'Custom path' },
  { key: 'open_conf'   as const, label: 'Modifier odoo.conf' },
  { key: 'delete'      as const, label: 'Supprimer' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function httpPortForBranch(branch: string): number {
  const m = branch.match(/(\d+)\./);
  return m ? 8000 + parseInt(m[1]!, 10) : 8069;
}

function injectHttpPort(conf: string, branch: string): string {
  const line = `http_port = ${httpPortForBranch(branch)}`;
  const lines = conf.split('\n');
  const idx = lines.findIndex(l => l.trimStart().startsWith('http_port'));
  if (idx >= 0) lines[idx] = line;
  return lines.join('\n');
}

function injectDataDir(conf: string, versionPath: string): string {
  const line = `data_dir = ${join(versionPath, 'datas')}`;
  const lines = conf.split('\n');
  const idx = lines.findIndex(l => l.trimStart().startsWith('data_dir'));
  if (idx >= 0) lines[idx] = line;
  return lines.join('\n');
}

async function generateConfContent(branch: string, versionPath: string): Promise<string> {
  const baseConf = await readBaseConf(versionPath);
  return injectDataDir(injectHttpPort(baseConf, branch), versionPath);
}

// ── Component ────────────────────────────────────────────────────────────────

export function ConfigureServiceScreen({
  config,
  leftWidth,
  initialService,
  onComplete,
  onBack,
  onParamSaved,
}: ConfigureServiceScreenProps) {
  const isEditing = !!initialService;
  const versions = sortedOdooVersions(Object.values(config.odoo_versions));
  const textColor = getTextColor(config);
  const cursorColor = getCursorColor(config);

  // ── Shared state ─────────────────────────────────────────────────────────

  const [step, setStep] = useState<Step>(isEditing ? 'edit_list' : 'name');
  const [editParamCursor, setEditParamCursor] = useState(0);
  const [editSaving, setEditSaving] = useState(false);

  const [nameInput, setNameInput] = useState(initialService?.name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmedName, setConfirmedName] = useState(initialService?.name ?? '');

  // Track the conf path currently persisted on disk, so repeated renames in
  // the same session (edit mode) always diff against the real current file.
  const currentConfPath = useRef(initialService?.confPath ?? '');

  const [selectedVersionIdx, setSelectedVersionIdx] = useState(0);

  const [customPathInput, setCustomPathInput] = useState(initialService?.rawCustomOverride ?? '');
  const [confirmedCustomPath, setConfirmedCustomPath] = useState(initialService?.rawCustomOverride ?? '');

  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Core save ─────────────────────────────────────────────────────────────

  const buildAndSave = useCallback(async (opts: {
    version: OdooVersion;
    name: string;
    oldConfPath?: string;
    rawCustomOverride: string;
  }): Promise<OdooServiceConfig> => {
    const configDir   = join(opts.version.path, 'config');
    const newConfPath = join(configDir, `${opts.name}.conf`);

    const missing = await findMissingCustomPath(opts.rawCustomOverride, opts.version.path);
    if (missing) throw new Error(`Dossier introuvable : ${missing}`);

    await mkdir(configDir, { recursive: true });

    const isRename = !!opts.oldConfPath && opts.oldConfPath !== newConfPath;
    if (isRename) {
      await rename(opts.oldConfPath!, newConfPath);
      // Follow the rename with the conventional custom/<name> folder, but
      // never move a folder pointed to by an explicit override.
      if (!opts.rawCustomOverride) {
        const oldName   = basename(opts.oldConfPath!, '.conf');
        const oldCustom = join(opts.version.path, 'custom', oldName);
        const newCustom = join(opts.version.path, 'custom', opts.name);
        if (await dirExists(oldCustom) && !(await dirExists(newCustom))) {
          await rename(oldCustom, newCustom);
        }
      }
    } else if (!opts.oldConfPath) {
      const confExists = await access(newConfPath).then(() => true).catch(() => false);
      if (!confExists) {
        await writeFile(newConfPath, await generateConfContent(opts.version.branch, opts.version.path), 'utf-8');
      }
    }

    const current   = await readConfig();
    const overrides = { ...(current.odoo_service_overrides ?? {}) };
    if (isRename) delete overrides[opts.oldConfPath!];
    if (opts.rawCustomOverride) overrides[newConfPath] = opts.rawCustomOverride;
    else delete overrides[newConfPath];
    await writeConfig({ ...current, odoo_service_overrides: overrides });

    return buildServiceConfig(opts.version, newConfPath, opts.rawCustomOverride);
  }, []);

  // ── Create mode: name → version → custom_path → save ─────────────────────

  const saveCreate = useCallback(async (rawCustomOverride: string) => {
    const version = versions[selectedVersionIdx];
    if (!version) return;
    setStep('saving');
    setSaveError(null);
    try {
      const confPath = join(version.path, 'config', `${confirmedName}.conf`);
      const exists = await access(confPath).then(() => true).catch(() => false);
      if (exists) {
        setSaveError(`Un service "${confirmedName}" existe déjà pour cette version.`);
        setStep('name');
        return;
      }
      const saved = await buildAndSave({ version, name: confirmedName, rawCustomOverride });
      currentConfPath.current = saved.confPath;
      setConfirmedCustomPath(rawCustomOverride);
      setStep('done');
    } catch (err) {
      setSaveError((err as Error).message);
      setStep('custom_path');
    }
  }, [versions, selectedVersionIdx, confirmedName, buildAndSave]);

  // ── Edit mode: save a single changed param and return to edit_list ────────

  const saveEditParam = useCallback(async (updates: {
    name?: string;
    rawCustomOverride?: string;
  }) => {
    const version: OdooVersion = versions.find(v => v.branch === initialService!.branch)
      ?? { branch: initialService!.branch, path: initialService!.versionPath };

    const newName             = updates.name             ?? confirmedName;
    const newRawCustomOverride = updates.rawCustomOverride ?? confirmedCustomPath;

    setEditSaving(true);
    setSaveError(null);
    try {
      const savedService = await buildAndSave({
        version,
        name: newName,
        oldConfPath: currentConfPath.current,
        rawCustomOverride: newRawCustomOverride,
      });
      currentConfPath.current = savedService.confPath;
      onParamSaved?.(savedService);
      if (updates.name              !== undefined) { setConfirmedName(updates.name); setNameInput(updates.name); }
      if (updates.rawCustomOverride !== undefined) { setConfirmedCustomPath(updates.rawCustomOverride); setCustomPathInput(updates.rawCustomOverride); }
    } catch (err) {
      setSaveError((err as Error).message);
    }
    setEditSaving(false);
    setStep('edit_list');
  }, [versions, confirmedName, confirmedCustomPath, buildAndSave, initialService, onParamSaved]);

  // ── Esc helper: depends on mode ───────────────────────────────────────────

  const escapeFrom = useCallback((s: Step) => {
    if (isEditing) { setStep('edit_list'); return; }
    switch (s) {
      case 'name':        onBack(); break;
      case 'version':     setStep('name'); break;
      case 'custom_path': setStep('version'); break;
    }
  }, [isEditing, onBack]);

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    try { await unlink(initialService!.confPath); } catch { /* already gone */ }
    const current = await readConfig();
    const overrides = { ...(current.odoo_service_overrides ?? {}) };
    delete overrides[initialService!.confPath];
    await writeConfig({ ...current, odoo_service_overrides: overrides });
    onComplete();
  }, [initialService, onComplete]);

  // ── Name submit (shared between create & edit) ────────────────────────────

  const handleNameSubmit = useCallback(async (value: string) => {
    const name = value.trim();
    if (!name) { setNameError('Le nom ne peut pas être vide.'); return; }
    setNameError(null);

    if (isEditing) {
      const currentName = basename(currentConfPath.current, '.conf');
      if (name !== currentName) {
        const conflictPath = join(initialService!.versionPath, 'config', `${name}.conf`);
        const conflicts = await access(conflictPath).then(() => true).catch(() => false);
        if (conflicts) { setNameError(`Un service "${name}" existe déjà pour cette version.`); return; }
      }
      void saveEditParam({ name });
    } else {
      if (versions.length === 0) { setNameError('Aucune version Odoo installée.'); return; }
      setConfirmedName(name);
      setStep('version');
    }
  }, [isEditing, initialService, versions, saveEditParam]);

  // ── Custom path submit (shared between create & edit) ─────────────────────

  const handleCustomPathSubmit = useCallback((value: string) => {
    const raw = value.trim();
    if (isEditing) void saveEditParam({ rawCustomOverride: raw });
    else           void saveCreate(raw);
  }, [isEditing, saveEditParam, saveCreate]);

  // ── Input hooks ───────────────────────────────────────────────────────────

  // edit_list
  useInput((_char, key) => {
    if (key.escape) { onBack(); return; }
    if (key.upArrow)   setEditParamCursor(p => (p - 1 + EDIT_PARAMS.length) % EDIT_PARAMS.length);
    if (key.downArrow) setEditParamCursor(p => (p + 1) % EDIT_PARAMS.length);
    if (key.return && !editSaving) {
      const param = EDIT_PARAMS[editParamCursor]!.key;
      switch (param) {
        case 'name':        setStep('name'); break;
        case 'custom_path': setCustomPathInput(confirmedCustomPath); setStep('custom_path'); break;
        case 'open_conf':   openInEditor(initialService!.confPath); break;
        case 'delete':      setStep('confirm_delete'); break;
      }
    }
  }, { isActive: step === 'edit_list' });

  // name: Esc (submit handled by TextInput)
  useInput(
    (_char, key) => { if (key.escape) escapeFrom('name'); },
    { isActive: step === 'name' },
  );

  // version (create mode only)
  useInput((_char, key) => {
    if (key.escape) { escapeFrom('version'); return; }
    if (key.upArrow)   setSelectedVersionIdx(p => (p - 1 + versions.length) % versions.length);
    if (key.downArrow) setSelectedVersionIdx(p => (p + 1) % versions.length);
    if (key.return) { setCustomPathInput(''); setStep('custom_path'); }
  }, { isActive: step === 'version' });

  // custom_path: Esc (submit handled by TextInput)
  useInput(
    (_char, key) => { if (key.escape) escapeFrom('custom_path'); },
    { isActive: step === 'custom_path' },
  );

  // done
  useInput(
    (_char, key) => { if (key.escape) onComplete(); },
    { isActive: step === 'done' },
  );

  // confirm_delete
  useInput(
    (_char, key) => {
      if (key.escape) { setStep('edit_list'); return; }
      if (key.return) void handleDelete();
    },
    { isActive: step === 'confirm_delete' },
  );

  // ── Render helpers ────────────────────────────────────────────────────────

  const selectedVersion = versions[selectedVersionIdx] as OdooVersion | undefined;

  const editParamValues: Record<string, string> = {
    name:        confirmedName || '—',
    custom_path: confirmedCustomPath || `custom/${confirmedName} (par défaut)`,
    open_conf:   '↵ ouvrir dans $EDITOR',
    delete:      '',
  };

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="row" flexGrow={1}>
      <LeftPanel width={leftWidth} primaryColor={getPrimaryColor(config)} textColor={textColor} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={getSecondaryColor(config)} bold>
          {isEditing ? `Modifier : ${initialService!.name}` : 'Nouveau service'}
        </Text>

        {isEditing && (
          <Text color={textColor} dimColor>
            {`Version : ${initialService!.branch}  ·  Enterprise : ${initialService!.useEnterprise ? 'oui (auto)' : 'non'}`}
          </Text>
        )}

        {/* ── edit_list ── */}
        {step === 'edit_list' && (
          <Box flexDirection="column" gap={0} marginTop={1}>
            {EDIT_PARAMS.map((p, i) => {
              const isSel = i === editParamCursor;
              const isDel = p.key === 'delete';
              return (
                <Box key={p.key} flexDirection="row" gap={1}>
                  <Text
                    color={isSel ? 'black' : (isDel ? 'red' : 'white')}
                    backgroundColor={isSel ? (isDel ? 'red' : cursorColor) : undefined}
                    bold={isSel || isDel}
                  >
                    {` ${isSel ? '▶' : ' '} ${p.label.padEnd(16)}`}
                  </Text>
                  <Text color={isSel ? 'cyan' : 'gray'} dimColor={!isSel}>
                    {editParamValues[p.key]}
                  </Text>
                </Box>
              );
            })}
            {saveError && <Box marginTop={1}><Text color="red">{saveError}</Text></Box>}
            {editSaving && <Text color={textColor} dimColor>⟳ Sauvegarde…</Text>}
            <Box marginTop={1}>
              <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ modifier  ·  Échap retour</Text>
            </Box>
          </Box>
        )}

        {/* ── name ── */}
        {step === 'name' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="white">Nom du service :</Text>
            <Box>
              <Text color={textColor} dimColor>{'› '}</Text>
              <TextInput
                value={nameInput}
                onChange={v => { setNameInput(v); setNameError(null); }}
                onSubmit={v => void handleNameSubmit(v)}
                placeholder="odoo-17-prod"
              />
            </Box>
            {nameError  && <Text color="red">{nameError}</Text>}
            {saveError  && <Text color="red">Erreur : {saveError}</Text>}
            <Text color={textColor} dimColor>↵ valider  ·  Échap {isEditing ? 'retour' : 'annuler'}</Text>
          </Box>
        )}

        {/* ── version ── */}
        {step === 'version' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="white">
              {'Service : '}<Text color={getPrimaryColor(config)} bold>{confirmedName}</Text>
            </Text>
            <Text color="white">Version Odoo :</Text>
            <Box flexDirection="column" gap={0}>
              {versions.map((v, i) => {
                const isSel = i === selectedVersionIdx;
                return (
                  <Text key={v.branch}
                    color={isSel ? 'black' : 'white'}
                    backgroundColor={isSel ? cursorColor : undefined}
                    bold={isSel}
                  >
                    {` ${isSel ? '▶' : ' '} ${v.branch}  `}
                    <Text color={isSel ? 'black' : 'gray'} dimColor={!isSel}>{v.path}</Text>
                  </Text>
                );
              })}
            </Box>
            <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour</Text>
          </Box>
        )}

        {/* ── custom_path ── */}
        {step === 'custom_path' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="white">Custom path :</Text>
            <Box>
              <Text color={textColor} dimColor>{'› '}</Text>
              <TextInput
                value={customPathInput}
                onChange={v => { setCustomPathInput(v); setSaveError(null); }}
                onSubmit={handleCustomPathSubmit}
                placeholder={`custom/${confirmedName || initialService?.name || ''} (par défaut)`}
              />
            </Box>
            <Text color={textColor} dimColor>
              Vide = utilise custom/&lt;nom&gt; s'il existe. Plusieurs dossiers : séparés par des virgules.
            </Text>
            {saveError && <Text color="red">Erreur : {saveError}</Text>}
            <Text color={textColor} dimColor>↵ valider  ·  Échap retour</Text>
          </Box>
        )}

        {/* ── confirm_delete ── */}
        {step === 'confirm_delete' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="red" bold>Supprimer le service «{initialService!.name}» ?</Text>
            <Text color={textColor} dimColor>  Le fichier .conf sera supprimé (les dossiers custom ne sont pas touchés) :</Text>
            <Text color={textColor} dimColor>  {initialService!.confPath}</Text>
            <Box marginTop={1}>
              <Text color={textColor} dimColor>↵ confirmer  ·  Échap annuler</Text>
            </Box>
          </Box>
        )}

        {/* ── saving ── */}
        {step === 'saving' && (
          <Box marginTop={1}>
            <Text color={textColor}>⟳ Enregistrement du service…</Text>
          </Box>
        )}

        {/* ── done ── */}
        {step === 'done' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="green">
              {'✓ Service '}<Text bold>{confirmedName}</Text>{' créé.'}
            </Text>
            <Text color={textColor} dimColor>
              {`  conf → ${join(selectedVersion?.path ?? '', 'config', `${confirmedName}.conf`)}`}
            </Text>
            <Text color={textColor} dimColor>
              {`  custom path → ${confirmedCustomPath || `custom/${confirmedName} (par défaut)`}`}
            </Text>
            <Text color={textColor} dimColor>Échap retour</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
