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
    version: '0.2.52',
    date: '2026-10-28',
    entries: [
      { type: 'fix', label: 'Désinstaller une base et Migration : liste des bases défilante, plus de cadre de recherche écrasé ni de lignes fusionnées' },
      { type: 'fix', label: 'Modification : liste des utilisateurs adaptée à la hauteur du terminal (plus de lignes fusionnées)' },
      { type: 'fix', label: 'Librairies Python : liste des dépendances à installer limitée à la hauteur du terminal' },
      { type: 'fix', label: 'Listes des dumps, bases et utilisateurs : affichage correct quand le bandeau de mise à jour est visible' },
    ],
  },
  {
    version: '0.2.51',
    date: '2026-10-27',
    entries: [
      { type: 'feat', label: 'Services : détection automatique des services depuis les fichiers .conf de chaque version (plus de liste stockée dans la config)' },
      { type: 'feat', label: 'Services : paramètre "Custom path" (chemins custom séparés par des virgules) à la place de la sélection Enterprise/dossiers custom' },
      { type: 'feat', label: 'Lancement d\'un service : option -p pour choisir le port HTTP, avec vérification de disponibilité à la validation' },
      { type: 'feat', label: 'Bases de données : neutralisation d\'une base (odoo-bin neutralize) depuis l\'écran de modification et après une restauration' },
      { type: 'fix',  label: 'Restauration : utilise le pg_restore le plus récent et repasse en mode séquentiel si le dump vient d\'un PostgreSQL plus récent que le serveur' },
      { type: 'fix',  label: 'Listes des services, dumps et bases : affichage défilant avec indicateurs ▲/▼, plus de lignes corrompues sur les petits terminaux' },
    ],
  },
  {
    version: '0.2.50',
    date: '2026-10-01',
    entries: [
      { type: 'feat', label: 'Commande code (IDE) : fusionne les clés manquantes dans un settings.json existant au lieu de l\'ignorer (lecture tolérante aux commentaires)' },
      { type: 'feat', label: 'Commande code (IDE) : ajout de réglages VS Code adaptés à Odoo (diagnosticMode, exclusions __pycache__/venv/datas/dumps)' },
    ],
  },
  {
    version: '0.2.49',
    date: '2026-09-26',
    entries: [
      { type: 'fix',  label: 'Installation des dépendances Python : bascule automatique sur psycopg2-binary sur macOS (évite l\'échec de compilation)' },
      { type: 'feat', label: 'Ajout du dépôt Odoo industry (clonage, mise à jour et addons-path) au même titre que community/enterprise/design-themes' },
    ],
  },
  {
    version: '0.2.48',
    date: '2026-08-24',
    entries: [
      { type: 'fix', label: 'Tests : dernières lignes toujours visibles (wrap → truncate, reset scroll à la fin)' },
    ],
  },
  {
    version: '0.2.47',
    date: '2026-08-05',
    entries: [
      { type: 'fix', label: 'Création de service : le fichier .conf n\'est plus écrasé s\'il existe déjà' },
      { type: 'feat', label: 'Migration : copie automatique du filestore vers la base migrée après une migration réussie' },
    ],
  },
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
