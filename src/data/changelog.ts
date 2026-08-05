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
    version: '0.2.46',
    date: '2026-08-05',
    entries: [
      { type: 'feat', label: 'Restauration : paramètre dump_path — scan récursif d\'un dossier supplémentaire (.zip, .sql, .dump) avec affichage du dossier source' },
      { type: 'feat', label: 'Restauration : barre de recherche dans la liste des fichiers dump' },
      { type: 'feat', label: 'Migration : barre de recherche dans la liste des bases de données' },
    ],
  },
  {
    version: '0.2.45',
    date: '2026-08-05',
    entries: [
      { type: 'fix',  label: 'Tests : port HTTP aléatoire basé sur le conf pour éviter les conflits (--no-http si absent)' },
      { type: 'feat', label: 'Ctrl+R pour relancer le dernier test sans ressaisir les paramètres' },
    ],
  },
  {
    version: '0.2.44',
    date: '2026-07-31',
    entries: [
      { type: 'feat', label: 'nupo start : lancement direct dans le terminal (sans TUI), avec --no-http et --shell fonctionnels' },
      { type: 'feat', label: 'Ajout de themes/ dans les addons-path quand useEnterprise est actif' },
      { type: 'feat', label: 'Barre de recherche dans "Désinstaller une base"' },
      { type: 'feat', label: 'Option --no-http dans le lancement de service (TUI et CLI)' },
    ],
  },
  {
    version: '0.2.43',
    date: '2026-07-26',
    entries: [
      { type: 'feat', label: 'Installation et mise à jour du repo design-themes (dossier themes/)' },
    ],
  },
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
