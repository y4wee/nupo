export type EntryType = 'feat' | 'fix' | 'chore';

export interface ChangelogEntry {
  type: EntryType;
  label: string;
}

export interface ChangelogVersion {
  version: string;
  date: string;
  entries: ChangelogEntry[];
}

export const CHANGELOG: ChangelogVersion[] = [
  {
    version: '0.2.41',
    date: '2026-07-26',
    entries: [
      { type: 'fix',  label: 'Scroll ↑↓ disponible après la fin des tests (succès ou échec)' },
    ],
  },
  {
    version: '0.2.40',
    date: '2026-07-26',
    entries: [
      { type: 'feat', label: 'Ctrl+U pour copier les N dernières lignes de logs (service et test)' },
      { type: 'feat', label: 'Scroll ↑↓ clavier dans les logs du service en cours d\'exécution' },
    ],
  },
  {
    version: '0.2.38',
    date: '2026-07-26',
    entries: [
      { type: 'fix',  label: 'Rafraîchissement du service après édition d\'un paramètre (customFolders, etc.)' },
    ],
  },
  {
    version: '0.2.37',
    date: '2026-07-26',
    entries: [
      { type: 'fix',  label: 'Vérification de module : lecture de l\'addons_path depuis le fichier .conf' },
      { type: 'fix',  label: 'Affichage des chemins vérifiés en cas de module introuvable' },
    ],
  },
  {
    version: '0.2.34',
    date: '2026-07-25',
    entries: [
      { type: 'fix',  label: 'Échap depuis Configurer renvoie au menu d\'actions du service' },
      { type: 'feat', label: 'Tri alphabétique et barre de recherche dans la liste des services' },
    ],
  },
  {
    version: '0.2.32',
    date: '2026-07-24',
    entries: [
      { type: 'feat', label: 'Écran Services : menu d\'actions par service (Configurer / Démarrer / Tester)' },
      { type: 'feat', label: 'Tester : sélection Module ou Tags, vérification d\'existence du module, logs en streaming' },
      { type: 'feat', label: 'Suppression du menu "Démarrer Service Odoo" (intégré dans Services)' },
    ],
  },
];
