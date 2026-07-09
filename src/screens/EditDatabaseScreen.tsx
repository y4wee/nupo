import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { join } from 'node:path';
import {
  NupoConfig,
  getPrimaryColor, getSecondaryColor, getTextColor, getCursorColor,
} from '../types/index.js';
import { LeftPanel } from '../components/LeftPanel.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import {
  listFilestoreDatabases, listUsers, hashPassword,
  setUserLogin, setUserPassword, setUserActive,
  getExpirationDate, extendExpirationDate,
  FilestoreEntry, OdooUser,
} from '../services/database.js';

interface EditDatabaseScreenProps {
  config: NupoConfig;
  leftWidth: number;
  onBack: () => void;
}

type EditPhase =
  | 'select_db'
  | 'select_db_option'
  | 'select_user'
  | 'select_action'
  | 'edit_login'
  | 'edit_password'
  | 'confirm_toggle'
  | 'confirm_expiration'
  | 'running'
  | 'done'
  | 'error';

const DB_OPTIONS = [
  { id: 'users'      as const, label: 'Gérer les utilisateurs' },
  { id: 'expiration' as const, label: 'Prolonger expiration date (+1 an)' },
];

export function EditDatabaseScreen({ config, leftWidth, onBack }: EditDatabaseScreenProps) {
  const { rows } = useTerminalSize();
  const primaryColor = getPrimaryColor(config);
  const secondaryColor = getSecondaryColor(config);
  const textColor = getTextColor(config);
  const cursorColor = getCursorColor(config);
  const userListHeight = Math.max(3, rows - 15);
  const versions = config.odoo_versions ?? {};

  const [phase, setPhase] = useState<EditPhase>('select_db');

  // DB list + search
  const [dbLoading, setDbLoading] = useState(true);
  const [databases, setDatabases] = useState<FilestoreEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [dbSel, setDbSel] = useState(0);
  const [selectedDb, setSelectedDb] = useState<FilestoreEntry | null>(null);

  // DB option menu
  const [dbOptionSel, setDbOptionSel] = useState(0);

  // User list
  const [usersLoading, setUsersLoading] = useState(false);
  const [users, setUsers] = useState<OdooUser[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [userSel, setUserSel] = useState(0);
  const [selectedUser, setSelectedUser] = useState<OdooUser | null>(null);

  // Action menu
  const [actionSel, setActionSel] = useState(0);

  // Text input
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  // Confirm toggle
  const [confirmSel, setConfirmSel] = useState(1);

  // Expiration
  const [currentExpDate, setCurrentExpDate] = useState<string | null>(null);
  const [newExpDate, setNewExpDate] = useState<string | null>(null);

  // Result
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<'login' | 'password' | 'toggle' | 'expiration' | null>(null);

  // ── Load databases on mount ───────────────────────────────────────────────

  useEffect(() => {
    void listFilestoreDatabases(Object.values(versions)).then(list => {
      setDatabases([...list].sort((a, b) => a.dbName.localeCompare(b.dbName)));
      setDbSel(0);
      setDbLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ───────────────────────────────────────────────────────────────

  const filteredDbs = databases.filter(db =>
    db.dbName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const currentDb      = filteredDbs[dbSel];
  const filteredUsers  = users.filter(u => u.login.toLowerCase().includes(userSearch.toLowerCase()));
  const currentUser    = filteredUsers[userSel];
  const toggleLabel = selectedUser
    ? (selectedUser.active ? 'Désactiver' : 'Activer')
    : '';

  const actions = [
    { id: 'login'    as const, label: 'Modifier le login' },
    { id: 'password' as const, label: 'Modifier le mot de passe' },
    { id: 'toggle'   as const, label: `${toggleLabel} le compte` },
  ];

  // ── Load users ────────────────────────────────────────────────────────────

  const loadUsers = useCallback((dbName: string) => {
    setUsersLoading(true);
    setUsers([]);
    setUsersError(null);
    setUserSearch('');
    setUserSel(0);
    void listUsers(dbName).then(result => {
      if (!result.ok) setUsersError(result.error ?? 'Erreur inconnue');
      setUsers(result.users);
      setUserSel(0);
      setUsersLoading(false);
    });
  }, []);

  // ── Input: select_db ──────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) {
      if (searchQuery) { setSearchQuery(''); setDbSel(0); }
      else onBack();
      return;
    }
    if (dbLoading || filteredDbs.length === 0) return;
    if (key.upArrow)   setDbSel(p => Math.max(0, p - 1));
    if (key.downArrow) setDbSel(p => Math.min(filteredDbs.length - 1, p + 1));
    if (key.return && currentDb) {
      setSelectedDb(currentDb);
      setDbOptionSel(0);
      setPhase('select_db_option');
    }
  }, { isActive: phase === 'select_db' });

  // ── Input: select_db_option ────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { setPhase('select_db'); return; }
    if (key.upArrow)   setDbOptionSel(p => Math.max(0, p - 1));
    if (key.downArrow) setDbOptionSel(p => Math.min(DB_OPTIONS.length - 1, p + 1));
    if (key.return) {
      const opt = DB_OPTIONS[dbOptionSel]!.id;
      if (opt === 'users') {
        if (selectedDb) loadUsers(selectedDb.dbName);
        setPhase('select_user');
      } else {
        void (async () => {
          if (!selectedDb) return;
          setPhase('running');
          const res = await getExpirationDate(selectedDb.dbName);
          if (!res.ok || !res.date) {
            setErrorMsg(res.error ?? "Impossible de lire la date d'expiration");
            setLastAction('expiration');
            setPhase('error');
            return;
          }
          const d = new Date(res.date);
          if (isNaN(d.getTime())) {
            setErrorMsg(`Format de date invalide : ${res.date}`);
            setLastAction('expiration');
            setPhase('error');
            return;
          }
          const next = new Date(d);
          next.setFullYear(next.getFullYear() + 1);
          setCurrentExpDate(res.date.slice(0, 10));
          setNewExpDate(next.toISOString().slice(0, 10));
          setConfirmSel(1);
          setPhase('confirm_expiration');
        })();
      }
    }
  }, { isActive: phase === 'select_db_option' });

  // ── Input: select_user ────────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) {
      if (userSearch) { setUserSearch(''); setUserSel(0); }
      else setPhase('select_db_option');
      return;
    }
    if (usersLoading || filteredUsers.length === 0) return;
    if (key.upArrow)   setUserSel(p => Math.max(0, p - 1));
    if (key.downArrow) setUserSel(p => Math.min(filteredUsers.length - 1, p + 1));
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
      if (id === 'login')    { setInputValue(''); setInputError(null); setLastAction('login'); setPhase('edit_login'); }
      if (id === 'password') { setInputValue(''); setInputError(null); setLastAction('password'); setPhase('edit_password'); }
      if (id === 'toggle')   { setConfirmSel(1); setLastAction('toggle'); setPhase('confirm_toggle'); }
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

  // ── Input: confirm_expiration ─────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape) { setPhase('select_db_option'); return; }
    if (key.leftArrow)  setConfirmSel(0);
    if (key.rightArrow) setConfirmSel(1);
    if (key.return) {
      if (confirmSel === 1) { setPhase('select_db_option'); return; }
      setLastAction('expiration');
      void runExtendExpiration();
    }
  }, { isActive: phase === 'confirm_expiration' });

  // ── Input: done / error ───────────────────────────────────────────────────

  useInput((_char, key) => {
    if (key.escape || key.return) {
      setErrorMsg(null);
      if (lastAction === 'login' || lastAction === 'password') {
        setPhase('select_action');
      } else if (lastAction === 'expiration') {
        setPhase('select_db_option');
      } else {
        if (selectedDb) loadUsers(selectedDb.dbName);
        setPhase('select_user');
      }
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

  const runExtendExpiration = useCallback(async () => {
    if (!selectedDb) return;
    setPhase('running');
    const result = await extendExpirationDate(selectedDb.dbName);
    setErrorMsg(result.error ?? null);
    if (result.ok) setNewExpDate(result.newDate ?? null);
    setPhase(result.ok ? 'done' : 'error');
  }, [selectedDb]);

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
            ) : (
              <>
                <Box flexDirection="row" gap={1}>
                  <Text color={textColor} dimColor>{'🔍 '}</Text>
                  <TextInput
                    value={searchQuery}
                    onChange={v => { setSearchQuery(v); setDbSel(0); }}
                    placeholder="Rechercher une base…"
                  />
                </Box>
                {filteredDbs.length === 0 ? (
                  <Text color="yellow">Aucune base correspondante.</Text>
                ) : (
                  <Box flexDirection="column" gap={0}>
                    {filteredDbs.map((db, i) => {
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
                )}
                <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ sélectionner  ·  Échap {searchQuery ? 'effacer' : 'retour'}</Text>
              </>
            )}
          </Box>
        )}

        {/* select_db_option */}
        {phase === 'select_db_option' && selectedDb && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Box flexDirection="row" gap={1}>
              <Text color={textColor} dimColor>Base :</Text>
              <Text color="white" bold>{selectedDb.dbName}</Text>
              <Text color={textColor} dimColor>{`[${selectedDb.versionBranch}]`}</Text>
            </Box>
            <Box flexDirection="column" gap={0}>
              {DB_OPTIONS.map((opt, i) => {
                const isSel = i === dbOptionSel;
                return (
                  <Text
                    key={opt.id}
                    color={isSel ? 'black' : 'white'}
                    backgroundColor={isSel ? cursorColor : undefined}
                    bold={isSel}
                  >
                    {` ${isSel ? '▶' : ' '} ${opt.label}`}
                  </Text>
                );
              })}
            </Box>
            <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ sélectionner  ·  Échap retour</Text>
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
                <Box flexDirection="row" gap={1}>
                  <Text color={textColor} dimColor>{'🔍 '}</Text>
                  <TextInput
                    value={userSearch}
                    onChange={v => { setUserSearch(v); setUserSel(0); }}
                    placeholder="Rechercher un utilisateur…"
                  />
                </Box>
                {filteredUsers.length === 0 ? (
                  <Text color="yellow">Aucun utilisateur correspondant.</Text>
                ) : (
                <>
                <Text color={textColor} dimColor>
                  {`Sélectionnez un utilisateur : `}
                  <Text dimColor>{`(${filteredUsers.length}${filteredUsers.length < users.length ? `/${users.length}` : ''})`}</Text>
                </Text>
                {(() => {
                  const itemsHeight = userListHeight - 2;
                  const winStart = Math.min(
                    Math.max(0, userSel - Math.floor(itemsHeight / 2)),
                    Math.max(0, filteredUsers.length - itemsHeight),
                  );
                  const winEnd = Math.min(filteredUsers.length, winStart + itemsHeight);
                  const visible = filteredUsers.slice(winStart, winEnd);
                  return (
                    <Box flexDirection="column" height={userListHeight} overflow="hidden">
                      <Text color={textColor} dimColor>
                        {winStart > 0 ? `  ↑ ${winStart} de plus` : ''}
                      </Text>
                      {visible.map((u, j) => {
                        const i = winStart + j;
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
                      <Text color={textColor} dimColor>
                        {winEnd < filteredUsers.length ? `  ↓ ${filteredUsers.length - winEnd} de plus` : ''}
                      </Text>
                    </Box>
                  );
                })()}
                <Text color={textColor} dimColor>↑↓ naviguer  ·  ↵ sélectionner  ·  Échap {userSearch ? 'effacer' : 'retour'}</Text>
                </>
                )}
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

        {/* confirm_expiration */}
        {phase === 'confirm_expiration' && selectedDb && (
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Box flexDirection="row" gap={1}>
              <Text color={textColor} dimColor>Base :</Text>
              <Text color="white" bold>{selectedDb.dbName}</Text>
            </Box>
            <Box flexDirection="column" gap={0}>
              <Box flexDirection="row" gap={1}>
                <Text color={textColor} dimColor>Date actuelle :</Text>
                <Text color="white">{currentExpDate ?? '—'}</Text>
              </Box>
              <Box flexDirection="row" gap={1}>
                <Text color={textColor} dimColor>Nouvelle date :</Text>
                <Text color="green" bold>{newExpDate ?? '—'}</Text>
              </Box>
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
            {lastAction === 'expiration' ? (
              <Text color="green">
                {'✓ Expiration prolongée jusqu\'au '}
                <Text bold>{newExpDate}</Text>
                {'.'}
              </Text>
            ) : (
              <Text color="green">✓ Modification appliquée avec succès.</Text>
            )}
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
