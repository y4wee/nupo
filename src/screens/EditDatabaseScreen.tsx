import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { join } from 'node:path';
import {
  NupoConfig,
  getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor,
} from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import {
  listFilestoreDatabases, listUsers, hashPassword,
  setUserLogin, setUserPassword, setUserActive,
  FilestoreEntry, OdooUser,
} from '../services/database.js';

interface EditDatabaseScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
}

type EditPhase =
  | 'select_db'
  | 'select_user'
  | 'select_action'
  | 'edit_login'
  | 'edit_password'
  | 'confirm_toggle'
  | 'running'
  | 'done'
  | 'error';

export function EditDatabaseScreen({ config, leftWidth, onBack }: EditDatabaseScreenProps) {
  const primaryColor = getPrimaryColor(config);
  const secondaryColor = getSecondaryColor(config);
  const textColor = getTextColor(config);
  const cursorColor = getCursorColor(config);
  const versions = config.odoo_versions ?? {};

  const [phase, setPhase] = useState<EditPhase>('select_db');

  // DB list
  const [dbLoading, setDbLoading] = useState(true);
  const [databases, setDatabases] = useState<FilestoreEntry[]>([]);
  const [dbSel, setDbSel] = useState(0);
  const [selectedDb, setSelectedDb] = useState<FilestoreEntry | null>(null);

  // User list
  const [usersLoading, setUsersLoading] = useState(false);
  const [users, setUsers] = useState<OdooUser[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [userSel, setUserSel] = useState(0);
  const [selectedUser, setSelectedUser] = useState<OdooUser | null>(null);

  // Action menu
  const [actionSel, setActionSel] = useState(0);

  // Text input
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  // Confirm toggle
  const [confirmSel, setConfirmSel] = useState(1);

  // Result
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Load databases on mount ───────────────────────────────────────────────

  useEffect(() => {
    void listFilestoreDatabases(Object.values(versions)).then(list => {
      setDatabases(list);
      setDbSel(0);
      setDbLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load users ────────────────────────────────────────────────────────────

  const loadUsers = useCallback((dbName: string) => {
    setUsersLoading(true);
    setUsers([]);
    setUsersError(null);
    void listUsers(dbName).then(result => {
      if (!result.ok) setUsersError(result.error ?? 'Erreur inconnue');
      setUsers(result.users);
      setUserSel(0);
      setUsersLoading(false);
    });
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────

  const currentDb   = databases[dbSel];
  const currentUser = users[userSel];
  const toggleLabel = selectedUser
    ? (selectedUser.active ? 'Désactiver' : 'Activer')
    : '';

  const actions = [
    { id: 'login'    as const, label: 'Modifier le login' },
    { id: 'password' as const, label: 'Modifier le mot de passe' },
    { id: 'toggle'   as const, label: `${toggleLabel} le compte` },
  ];

  // ── Input: select_db ──────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { onBack(); return; }
    if (dbLoading || databases.length === 0) return;
    if (key.upArrow)   setDbSel(p => Math.max(0, p - 1));
    if (key.downArrow) setDbSel(p => Math.min(databases.length - 1, p + 1));
    if (key.return && currentDb) {
      setSelectedDb(currentDb);
      loadUsers(currentDb.dbName);
      setPhase('select_user');
    }
  }, { isActive: phase === 'select_db' });

  // ── Input: select_user ────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { setPhase('select_db'); return; }
    if (usersLoading || users.length === 0) return;
    if (key.upArrow)   setUserSel(p => Math.max(0, p - 1));
    if (key.downArrow) setUserSel(p => Math.min(users.length - 1, p + 1));
    if (key.return && currentUser) {
      setSelectedUser(currentUser);
      setActionSel(0);
      setPhase('select_action');
    }
  }, { isActive: phase === 'select_user' });

  // ── Input: select_action ──────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { setPhase('select_user'); return; }
    if (key.upArrow)   setActionSel(p => Math.max(0, p - 1));
    if (key.downArrow) setActionSel(p => Math.min(actions.length - 1, p + 1));
    if (key.return) {
      const id = actions[actionSel]!.id;
      if (id === 'login')    { setInputValue(''); setInputError(null); setPhase('edit_login'); }
      if (id === 'password') { setInputValue(''); setInputError(null); setPhase('edit_password'); }
      if (id === 'toggle')   { setConfirmSel(1); setPhase('confirm_toggle'); }
    }
  }, { isActive: phase === 'select_action' });

  // ── Input: edit_login / edit_password — Escape only ──────────────────────

  useInput((_char, key) => {
    if (key.escape) setPhase('select_action');
  }, { isActive: phase === 'edit_login' });

  useInput((_char, key) => {
    if (key.escape) setPhase('select_action');
  }, { isActive: phase === 'edit_password' });

  // ── Input: confirm_toggle ─────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { setPhase('select_action'); return; }
    if (key.leftArrow)  setConfirmSel(0);
    if (key.rightArrow) setConfirmSel(1);
    if (key.return) {
      if (confirmSel === 1) { setPhase('select_action'); return; }
      void runToggle();
    }
  }, { isActive: phase === 'confirm_toggle' });

  // ── Input: done / error ───────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape || key.return) {
      setErrorMsg(null);
      if (selectedDb) loadUsers(selectedDb.dbName);
      setPhase('select_user');
    }
  }, { isActive: phase === 'done' || phase === 'error' });

  // ── Runners ───────────────────────────────────────────────────────────────

  const handleLoginSubmit = useCallback(async (value: string) => {
    const v = value.trim();
    if (!v) { setInputError('Le login ne peut pas être vide.'); return; }
    if (!selectedDb || !selectedUser) return;
    setPhase('running');
    const result = await setUserLogin(selectedDb.dbName, selectedUser.id, v);
    setErrorMsg(result.error ?? null);
    setPhase(result.ok ? 'done' : 'error');
  }, [selectedDb, selectedUser]);

  const handlePasswordSubmit = useCallback(async (value: string) => {
    if (!value) { setInputError('Le mot de passe ne peut pas être vide.'); return; }
    if (!selectedDb || !selectedUser) return;
    setPhase('running');
    const versionPath = versions[selectedDb.versionBranch]?.path ?? '';
    const venvPython = join(versionPath, '.venv', 'bin', 'python');
    const hashResult = await hashPassword(value, venvPython);
    if (!hashResult.ok) {
      setErrorMsg(hashResult.error);
      setPhase('error');
      return;
    }
    const result = await setUserPassword(selectedDb.dbName, selectedUser.id, hashResult.hash);
    setErrorMsg(result.error ?? null);
    setPhase(result.ok ? 'done' : 'error');
  }, [selectedDb, selectedUser, versions]);

  const runToggle = useCallback(async () => {
    if (!selectedDb || !selectedUser) return;
    setPhase('running');
    const result = await setUserActive(selectedDb.dbName, selectedUser.id, !selectedUser.active);
    setErrorMsg(result.error ?? null);
    setPhase(result.ok ? 'done' : 'error');
  }, [selectedDb, selectedUser]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="row" flexGrow={1}>
      <LeftPanel width={leftWidth} primaryColor={primaryColor} textColor={textColor} />

      <Box flexGrow={1} flexDirection="column" paddingX={3} paddingY={2} gap={1}>
        <Text color={secondaryColor} bold>Modifier une base</Text>

        {/* select_db */}
        {phase === 'select_db' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            {dbLoading ? (
              <Text color={textColor} dimColor>Chargement…</Text>
            ) : databases.length === 0 ? (
              <>
                <Text color="yellow">Aucune base trouvée dans les filestores.</Text>
                <Text color={textColor} dimColor>Échap retour</Text>
              </>
            ) : (
              <>
                <Text color={textColor} dimColor>Sélectionnez une base :</Text>
                <Box flexDirection="column" gap={0}>
                  {databases.map((db, i) => {
                    const isSel = i === dbSel;
                    return (
                      <Box key={`${db.versionBranch}/${db.dbName}`} flexDirection="row">
                        <Text
                          color={isSel ? 'black' : 'white'}
                          backgroundColor={isSel ? cursorColor : undefined}
                          bold={isSel}
                        >
                          {` ${isSel ? '▶' : ' '} ${db.dbName}`}
                        </Text>
                        <Text
                          color={isSel ? 'black' : textColor}
                          backgroundColor={isSel ? cursorColor : undefined}
                          dimColor={!isSel}
                        >
                          {`  [${db.versionBranch}]`}
                        </Text>
                      </Box>
                    );
                  })}
                </Box>
                <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour</Text>
              </>
            )}
          </Box>
        )}

        {/* select_user */}
        {phase === 'select_user' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Box flexDirection="row" gap={1}>
              <Text color={textColor} dimColor>Base :</Text>
              <Text color="white">{selectedDb?.dbName}</Text>
              <Text color={textColor} dimColor>{`[${selectedDb?.versionBranch}]`}</Text>
            </Box>
            {usersLoading ? (
              <Text color={textColor} dimColor>Chargement des utilisateurs…</Text>
            ) : usersError ? (
              <>
                <Text color="red">Impossible de lister les utilisateurs.</Text>
                <Text color="red" dimColor>{usersError}</Text>
                <Text color={textColor} dimColor>Échap retour</Text>
              </>
            ) : users.length === 0 ? (
              <>
                <Text color="yellow">Aucun utilisateur trouvé (pas une base Odoo ?).</Text>
                <Text color={textColor} dimColor>Échap retour</Text>
              </>
            ) : (
              <>
                <Text color={textColor} dimColor>Sélectionnez un utilisateur :</Text>
                <Box flexDirection="column" gap={0}>
                  {users.map((u, i) => {
                    const isSel = i === userSel;
                    return (
                      <Box key={u.id} flexDirection="row">
                        <Text
                          color={isSel ? 'black' : 'white'}
                          backgroundColor={isSel ? cursorColor : undefined}
                          bold={isSel}
                        >
                          {` ${isSel ? '▶' : ' '} ${u.login}`}
                        </Text>
                        <Text
                          color={isSel ? 'black' : (u.active ? 'green' : 'red')}
                          backgroundColor={isSel ? cursorColor : undefined}
                          dimColor={!isSel}
                        >
                          {`  ${u.active ? 'actif' : 'inactif'}`}
                        </Text>
                      </Box>
                    );
                  })}
                </Box>
                <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour</Text>
              </>
            )}
          </Box>
        )}

        {/* select_action */}
        {phase === 'select_action' && selectedUser && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Box flexDirection="row" gap={1}>
              <Text color={textColor} dimColor>Utilisateur :</Text>
              <Text color="white" bold>{selectedUser.login}</Text>
              <Text color={selectedUser.active ? 'green' : 'red'} dimColor>
                {selectedUser.active ? '(actif)' : '(inactif)'}
              </Text>
            </Box>
            <Box flexDirection="column" gap={0}>
              {actions.map((a, i) => {
                const isSel = i === actionSel;
                return (
                  <Text
                    key={a.id}
                    color={isSel ? 'black' : 'white'}
                    backgroundColor={isSel ? cursorColor : undefined}
                    bold={isSel}
                  >
                    {` ${isSel ? '▶' : ' '} ${a.label}`}
                  </Text>
                );
              })}
            </Box>
            <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour</Text>
          </Box>
        )}

        {/* edit_login */}
        {phase === 'edit_login' && selectedUser && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Box flexDirection="row" gap={1}>
              <Text color={textColor} dimColor>Login actuel :</Text>
              <Text color="white">{selectedUser.login}</Text>
            </Box>
            <Text color="white">Nouveau login :</Text>
            <Box>
              <Text color={textColor} dimColor>{'› '}</Text>
              <TextInput
                value={inputValue}
                onChange={v => { setInputValue(v); setInputError(null); }}
                onSubmit={handleLoginSubmit}
                placeholder={selectedUser.login}
              />
            </Box>
            {inputError && <Text color="red">{inputError}</Text>}
            <Text color={textColor} dimColor>↵ valider  ·  Échap retour</Text>
          </Box>
        )}

        {/* edit_password */}
        {phase === 'edit_password' && selectedUser && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Box flexDirection="row" gap={1}>
              <Text color={textColor} dimColor>Utilisateur :</Text>
              <Text color="white">{selectedUser.login}</Text>
            </Box>
            <Text color="white">Nouveau mot de passe :</Text>
            <Box>
              <Text color={textColor} dimColor>{'› '}</Text>
              <TextInput
                value={inputValue}
                onChange={v => { setInputValue(v); setInputError(null); }}
                onSubmit={handlePasswordSubmit}
                mask="*"
              />
            </Box>
            {inputError && <Text color="red">{inputError}</Text>}
            <Text color={textColor} dimColor>↵ valider  ·  Échap retour</Text>
          </Box>
        )}

        {/* confirm_toggle */}
        {phase === 'confirm_toggle' && selectedUser && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Box flexDirection="row" gap={1}>
              <Text color="white">{toggleLabel}</Text>
              <Text color="white" bold>{selectedUser.login}</Text>
              <Text color={textColor} dimColor>
                {selectedUser.active ? '(actuellement actif)' : '(actuellement inactif)'}
              </Text>
            </Box>
            <Box flexDirection="row" gap={2} marginTop={1}>
              <Text
                color={confirmSel === 0 ? 'black' : primaryColor}
                backgroundColor={confirmSel === 0 ? primaryColor : undefined}
                bold={confirmSel === 0}
              >
                {' Confirmer '}
              </Text>
              <Text
                color={confirmSel === 1 ? 'black' : textColor}
                backgroundColor={confirmSel === 1 ? cursorColor : undefined}
                bold={confirmSel === 1}
              >
                {' Annuler '}
              </Text>
            </Box>
            <Text color={textColor} dimColor>◀▶ choisir  ·  ↵ confirmer  ·  Échap annuler</Text>
          </Box>
        )}

        {/* running */}
        {phase === 'running' && (
          <Box marginTop={1}>
            <Text color={textColor} dimColor>En cours…</Text>
          </Box>
        )}

        {/* done */}
        {phase === 'done' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="green">✓ Modification appliquée avec succès.</Text>
            <Text color={textColor} dimColor>↵/Échap retour</Text>
          </Box>
        )}

        {/* error */}
        {phase === 'error' && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text color="red">✗ Erreur lors de la modification.</Text>
            {errorMsg && (
              <Box borderStyle="round" borderColor="red" paddingX={1}>
                <Text color="red" wrap="wrap">{errorMsg}</Text>
              </Box>
            )}
            <Text color={textColor} dimColor>↵/Échap retour</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
