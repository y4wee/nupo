import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { readdir, stat, mkdir, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { NupoConfig, OdooVersion, OdooServiceConfig, getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor } from '../types/index.js';
import { readConfig, writeConfig, readBaseConf } from '../services/config.js';
import { openInEditor } from '../services/system.js';
import { LeftPanel } from '../components/LeftPanel.js';

interface ConfigureServiceScreenProps {
  config: NupoConfig;
  leftWidth: number;
  initialService?: OdooServiceConfig;
  onComplete: () => void;
  onBack: () => void;
}

// ── Step type ────────────────────────────────────────────────────────────────
// 'edit_list' = param selection screen shown in edit mode
type Step = 'edit_list' | 'name' | 'version' | 'enterprise' | 'custom_folders' | 'saving' | 'done' | 'confirm_delete';

const EDIT_PARAMS = [
  { key: 'name'           as const, label: 'Nom' },
  { key: 'version'        as const, label: 'Version' },
  { key: 'enterprise'     as const, label: 'Enterprise' },
  { key: 'custom_folders' as const, label: 'Dossiers custom' },
  { key: 'open_conf'      as const, label: 'Modifier odoo.conf' },
  { key: 'delete'         as const, label: 'Supprimer' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function dirExists(p: string): Promise<boolean> {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

async function loadCustomFolders(versionPath: string): Promise<string[]> {
  try {
    const entries = await readdir(join(versionPath, 'custom'), { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  } catch { return []; }
}

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
  const line = `data_dir = ${versionPath}`;
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
}: ConfigureServiceScreenProps) {
  const isEditing = !!initialService;
  const versions = Object.values(config.odoo_versions);
  const textColor = getTextColor(config);
  const cursorColor = getCursorColor(config);

  // ── Shared state ─────────────────────────────────────────────────────────

  const [step, setStep] = useState<Step>(isEditing ? 'edit_list' : 'name');
  const [editParamCursor, setEditParamCursor] = useState(0);
  const [editSaving, setEditSaving] = useState(false);

  const [nameInput, setNameInput] = useState(initialService?.name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmedName, setConfirmedName] = useState(initialService?.name ?? '');

  // Track the name currently persisted in config so we can rename correctly
  const lastSavedName = useRef(initialService?.name ?? '');

  const [selectedVersionIdx, setSelectedVersionIdx] = useState(() => {
    if (initialService) {
      const idx = versions.findIndex(v => v.branch === initialService.branch);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  });

  const [transitioning, setTransitioning] = useState(false);
  const [hasEnterprise, setHasEnterprise] = useState(false);
  const [enterpriseAction, setEnterpriseAction] = useState<0 | 1>(
    initialService ? (initialService.useEnterprise ? 0 : 1) : 0,
  );

  const [customFoldersList, setCustomFoldersList] = useState<string[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(
    new Set(initialService?.customFolders ?? []),
  );
  const [folderCursor, setFolderCursor] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Pre-load enterprise / folders on mount in edit mode
  useEffect(() => {
    if (!initialService) return;
    const version = versions.find(v => v.branch === initialService.branch);
    if (!version) return;
    void dirExists(join(version.path, 'enterprise')).then(setHasEnterprise);
    void loadCustomFolders(version.path).then(setCustomFoldersList);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Core save ─────────────────────────────────────────────────────────────

  const buildAndSave = useCallback(async (opts: {
    name: string;
    version: OdooVersion;
    useEnterprise: boolean;
    folders: string[];
  }) => {
    const confPath = join(opts.version.path, 'config', `${opts.name}.conf`);
    const service: OdooServiceConfig = {
      name: opts.name,
      branch: opts.version.branch,
      versionPath: opts.version.path,
      useEnterprise: opts.useEnterprise,
      customFolders: opts.folders,
      confPath,
    };
    await mkdir(join(opts.version.path, 'config'), { recursive: true });
    await writeFile(confPath, await generateConfContent(opts.version.branch, opts.version.path), 'utf-8');

    const current = await readConfig();
    const services = { ...(current.odoo_services ?? {}) };
    // Rename: delete old entry if name changed
    if (lastSavedName.current && lastSavedName.current !== opts.name) {
      delete services[lastSavedName.current];
    }
    services[opts.name] = service;
    await writeConfig({ ...current, odoo_services: services });
    lastSavedName.current = opts.name;
  }, []);

  // ── Create mode: version → enterprise → custom_folders → save ────────────

  const handleVersionSelectCreate = useCallback(async () => {
    if (transitioning) return;
    const version = versions[selectedVersionIdx];
    if (!version) return;
    setTransitioning(true);
    const enterprise = await dirExists(join(version.path, 'enterprise'));
    const folders = await loadCustomFolders(version.path);
    setHasEnterprise(enterprise);
    setCustomFoldersList(folders);
    setSelectedFolders(new Set()); // reset only in create mode
    setFolderCursor(0);
    setTransitioning(false);
    setStep(enterprise ? 'enterprise' : 'custom_folders');
  }, [transitioning, selectedVersionIdx, versions]);

  const saveCreate = useCallback(async () => {
    const version = versions[selectedVersionIdx];
    if (!version) return;
    setStep('saving');
    setSaveError(null);
    try {
      await buildAndSave({
        name: confirmedName,
        version,
        useEnterprise: hasEnterprise && enterpriseAction === 0,
        folders: [...selectedFolders].sort(),
      });
      setStep('done');
    } catch (err) {
      setSaveError((err as NodeJS.ErrnoException).message);
      setStep('name');
    }
  }, [versions, selectedVersionIdx, confirmedName, hasEnterprise, enterpriseAction, selectedFolders, buildAndSave]);

  // ── Edit mode: save a single changed param and return to edit_list ────────

  const saveEditParam = useCallback(async (updates: {
    name?: string;
    versionIdx?: number;
    useEnterprise?: boolean;
    folders?: string[];
  }) => {
    const vIdx = updates.versionIdx ?? selectedVersionIdx;
    const version = versions[vIdx];
    if (!version) return;

    const newName         = updates.name         ?? confirmedName;
    const newUseEnterprise = updates.useEnterprise ?? (hasEnterprise && enterpriseAction === 0);
    const newFolders      = updates.folders       ?? [...selectedFolders].sort();

    setEditSaving(true);
    setSaveError(null);
    try {
      await buildAndSave({ name: newName, version, useEnterprise: newUseEnterprise, folders: newFolders });
      // Commit new values to state
      if (updates.name         !== undefined) { setConfirmedName(updates.name); setNameInput(updates.name); }
      if (updates.versionIdx   !== undefined)   setSelectedVersionIdx(updates.versionIdx);
      if (updates.useEnterprise !== undefined)   setEnterpriseAction(updates.useEnterprise ? 0 : 1);
      if (updates.folders      !== undefined)    setSelectedFolders(new Set(updates.folders));
    } catch (err) {
      setSaveError((err as NodeJS.ErrnoException).message);
    }
    setEditSaving(false);
    setStep('edit_list');
  }, [
    selectedVersionIdx, versions, confirmedName, hasEnterprise,
    enterpriseAction, selectedFolders, buildAndSave,
  ]);

  // Edit mode: version change → auto-adapt enterprise & folders, then save
  const handleVersionSelectEdit = useCallback(async () => {
    if (transitioning) return;
    const version = versions[selectedVersionIdx];
    if (!version) return;
    setTransitioning(true);

    const enterprise = await dirExists(join(version.path, 'enterprise'));
    const folders = await loadCustomFolders(version.path);
    const validFolders = [...selectedFolders].filter(f => folders.includes(f));

    setHasEnterprise(enterprise);
    setCustomFoldersList(folders);
    if (!enterprise) setEnterpriseAction(1);
    setTransitioning(false);

    await saveEditParam({
      versionIdx: selectedVersionIdx,
      useEnterprise: enterprise && enterpriseAction === 0,
      folders: validFolders.sort(),
    });
  }, [transitioning, selectedVersionIdx, versions, selectedFolders, enterpriseAction, saveEditParam]);

  // Edit mode: open enterprise param (need to check availability first)
  const openEnterpriseEdit = useCallback(async () => {
    const version = versions[selectedVersionIdx];
    if (!version) return;
    setTransitioning(true);
    const enterprise = await dirExists(join(version.path, 'enterprise'));
    setHasEnterprise(enterprise);
    setTransitioning(false);
    setStep('enterprise');
  }, [selectedVersionIdx, versions]);

  // Edit mode: open custom_folders param (reload list, keep selection)
  const openCustomFoldersEdit = useCallback(async () => {
    const version = versions[selectedVersionIdx];
    if (!version) return;
    setTransitioning(true);
    const folders = await loadCustomFolders(version.path);
    setCustomFoldersList(folders);
    setFolderCursor(0);
    setTransitioning(false);
    setStep('custom_folders');
  }, [selectedVersionIdx, versions]);

  // ── Esc helper: depends on mode ───────────────────────────────────────────

  const escapeFrom = useCallback((s: Step) => {
    if (isEditing) { setStep('edit_list'); return; }
    switch (s) {
      case 'name':           onBack(); break;
      case 'version':        setStep('name'); break;
      case 'enterprise':     setStep('version'); break;
      case 'custom_folders': setStep(hasEnterprise ? 'enterprise' : 'version'); break;
    }
  }, [isEditing, hasEnterprise, onBack]);

  // ── Input hooks ───────────────────────────────────────────────────────────

  // edit_list
  useInput((_char, key) => {
    if (key.escape) { onBack(); return; }
    if (key.upArrow)   setEditParamCursor(p => (p - 1 + EDIT_PARAMS.length) % EDIT_PARAMS.length);
    if (key.downArrow) setEditParamCursor(p => (p + 1) % EDIT_PARAMS.length);
    if (key.return && !editSaving && !transitioning) {
      const param = EDIT_PARAMS[editParamCursor]!.key;
      switch (param) {
        case 'name':           setStep('name'); break;
        case 'version':        setStep('version'); break;
        case 'enterprise':     void openEnterpriseEdit(); break;
        case 'custom_folders': void openCustomFoldersEdit(); break;
        case 'open_conf':      openInEditor(initialService!.confPath); break;
        case 'delete':         setStep('confirm_delete'); break;
      }
    }
  }, { isActive: step === 'edit_list' });

  // name: Esc
  useInput(
    (_char, key) => { if (key.escape) escapeFrom('name'); },
    { isActive: step === 'name' },
  );

  // version
  useInput((_char, key) => {
    if (key.escape) { escapeFrom('version'); return; }
    if (key.upArrow)   setSelectedVersionIdx(p => (p - 1 + versions.length) % versions.length);
    if (key.downArrow) setSelectedVersionIdx(p => (p + 1) % versions.length);
    if (key.return) {
      if (isEditing) void handleVersionSelectEdit();
      else           void handleVersionSelectCreate();
    }
  }, { isActive: step === 'version' && !transitioning });

  // enterprise
  useInput((_char, key) => {
    if (key.escape) { escapeFrom('enterprise'); return; }
    if (key.leftArrow)  setEnterpriseAction(0);
    if (key.rightArrow) setEnterpriseAction(1);
    if (key.return) {
      if (isEditing) void saveEditParam({ useEnterprise: enterpriseAction === 0 });
      else           setStep('custom_folders');
    }
  }, { isActive: step === 'enterprise' });

  // custom_folders
  useInput((char, key) => {
    if (key.escape) { escapeFrom('custom_folders'); return; }
    if (key.upArrow)   setFolderCursor(p => Math.max(0, p - 1));
    if (key.downArrow) setFolderCursor(p => Math.min(customFoldersList.length - 1, p + 1));
    if (char === ' ' && customFoldersList[folderCursor]) {
      const folder = customFoldersList[folderCursor]!;
      setSelectedFolders(prev => {
        const next = new Set(prev);
        if (next.has(folder)) next.delete(folder); else next.add(folder);
        return next;
      });
    }
    if (key.return) {
      if (isEditing) void saveEditParam({ folders: [...selectedFolders].sort() });
      else           void saveCreate();
    }
  }, { isActive: step === 'custom_folders' });

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

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    try { await unlink(initialService!.confPath); } catch { /* already gone */ }
    const current = await readConfig();
    const services = { ...(current.odoo_services ?? {}) };
    delete services[initialService!.name];
    await writeConfig({ ...current, odoo_services: services });
    onComplete();
  }, [initialService, onComplete]);

  // ── Name submit (shared between create & edit) ────────────────────────────

  const handleNameSubmit = (value: string) => {
    const name = value.trim();
    if (!name) { setNameError('Le nom ne peut pas être vide.'); return; }
    const existing = config.odoo_services ?? {};
    if (existing[name] && name !== lastSavedName.current) {
      setNameError(`Un service "${name}" existe déjà.`); return;
    }
    setNameError(null);
    if (isEditing) {
      void saveEditParam({ name });
    } else {
      if (versions.length === 0) { setNameError('Aucune version Odoo installée.'); return; }
      setConfirmedName(name);
      setStep('version');
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const selectedVersion = versions[selectedVersionIdx] as OdooVersion | undefined;

  const editParamValues: Record<string, string> = {
    name:           confirmedName || '—',
    version:        selectedVersion?.branch ?? '—',
    enterprise:     hasEnterprise ? (enterpriseAction === 0 ? 'Oui' : 'Non') : 'Non disponible',
    custom_folders: selectedFolders.size > 0 ? [...selectedFolders].join(', ') : 'Aucun',
    open_conf:      '↵ ouvrir dans $EDITOR',
    delete:         '',
  };

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="row" flexGrow={1}>
      <LeftPanel width={leftWidth} primaryColor={getPrimaryColor(config)} textColor={textColor} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={getSecondaryColor(config)} bold>
          {isEditing ? `Modifier : ${initialService!.name}` : 'Nouveau service'}
        </Text>

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
            {(editSaving || transitioning) && <Text color={textColor} dimColor>⟳ Sauvegarde…</Text>}
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
                onSubmit={handleNameSubmit}
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
            {!isEditing && (
              <Text color="white">
                {'Service : '}<Text color={getPrimaryColor(config)} bold>{confirmedName}</Text>
              </Text>
            )}
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
            {transitioning && <Text color={textColor} dimColor>⟳ Vérification…</Text>}
            <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour</Text>
          </Box>
        )}

        {/* ── enterprise ── */}
        {step === 'enterprise' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="white">
              {'Version : '}<Text color={getPrimaryColor(config)}>{selectedVersion?.branch}</Text>
            </Text>
            {!hasEnterprise ? (
              <>
                <Text color="yellow">Enterprise non disponible pour cette version.</Text>
                <Text color={textColor} dimColor>Échap retour</Text>
              </>
            ) : (
              <>
                <Text color="white">Utiliser Enterprise ?</Text>
                <Box flexDirection="row" gap={2}>
                  <Text color={enterpriseAction === 0 ? 'black' : 'white'}
                    backgroundColor={enterpriseAction === 0 ? cursorColor : undefined}
                    bold={enterpriseAction === 0}>{' ✓ Oui '}</Text>
                  <Text color={enterpriseAction === 1 ? 'black' : 'white'}
                    backgroundColor={enterpriseAction === 1 ? 'gray' : undefined}
                    bold={enterpriseAction === 1}>{' ✗ Non '}</Text>
                </Box>
                <Text color={textColor} dimColor>◀▶ choisir  ·  ↵ confirmer  ·  Échap retour</Text>
              </>
            )}
          </Box>
        )}

        {/* ── custom_folders ── */}
        {step === 'custom_folders' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="white">Dossiers custom à inclure :</Text>
            {customFoldersList.length === 0 ? (
              <Box flexDirection="column" gap={0}>
                <Text color={textColor} dimColor>  Aucun module dans custom/</Text>
                <Text color={textColor} dimColor>↵ continuer  ·  Échap retour</Text>
              </Box>
            ) : (
              <Box flexDirection="column" gap={0}>
                {customFoldersList.map((folder, i) => {
                  const isCursor  = i === folderCursor;
                  const isChecked = selectedFolders.has(folder);
                  return (
                    <Text key={folder}
                      color={isCursor ? 'black' : 'white'}
                      backgroundColor={isCursor ? cursorColor : undefined}
                      bold={isCursor}
                    >
                      {` ${isChecked ? '[✓]' : '[ ]'} ${folder}`}
                    </Text>
                  );
                })}
                <Box marginTop={1} flexDirection="column" gap={0}>
                  {selectedFolders.size > 0 && (
                    <Text color="yellow" dimColor>
                      {`  ${selectedFolders.size} sélectionné(s) : ${[...selectedFolders].join(', ')}`}
                    </Text>
                  )}
                  <Text color={textColor} dimColor>
                    ↑↓ naviguer  ·  Espace sélectionner  ·  ↵ confirmer  ·  Échap retour
                  </Text>
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* ── confirm_delete ── */}
        {step === 'confirm_delete' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="red" bold>Supprimer le service «{initialService!.name}» ?</Text>
            <Text color={textColor} dimColor>  Le fichier .conf sera également supprimé :</Text>
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
            <Text color={textColor} dimColor>Échap retour</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
