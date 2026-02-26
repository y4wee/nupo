# nupo

**nupo** est un gestionnaire d'environnements de développement Odoo en ligne de commande. Il simplifie l'installation, la configuration et le lancement de plusieurs versions d'Odoo en parallèle, directement depuis le terminal.

---

## Fonctionnalités

- **Installation de versions Odoo** — clone community + enterprise, création du virtualenv Python, installation des dépendances
- **Mise à jour des versions** — vérification et mise à jour vers le dernier commit distant
- **Gestion de services** — créer, modifier, supprimer des configurations de service Odoo (port HTTP, modules custom, conf Odoo)
- **Lancement de services** — démarrage avec options (-d, -u, -i, --shell, --stop-after-init) et visualiseur de logs en temps réel avec filtrage
- **Configuration VS Code** — génération automatique de `settings.json` / `launch.json` pour le debug Odoo
- **Interface themeable** — couleurs entièrement personnalisables (primary, secondary, text, cursor)
- **Reprise d'installation** — une installation interrompue peut être reprise à l'étape où elle s'est arrêtée

---

## Prérequis

- **Node.js** ≥ 18
- **Python** ≥ 3.8 avec `pip` et `venv`
- **Git**
- Un dépôt **Odoo Community** accessible en local ou clonable

> Pour Odoo Enterprise : une clé SSH avec accès au dépôt `git@github.com:odoo/enterprise.git` est requise.

---

## Installation

### Via le script d'installation (Linux & macOS)

```bash
curl -fsSL https://y4wee.github.io/nupo/install.sh | bash
```

Le script vérifie automatiquement la présence de Node.js ≥ 18 et l'installe via `nvm` si nécessaire.

### Via npm

```bash
npm install -g @y4wee/nupo
```

---

## Utilisation

### Interface interactive

```bash
nupo
```

Lance le menu principal avec navigation au clavier (↑↓ pour naviguer, ↵ pour sélectionner, Échap pour revenir).

### Commandes CLI

#### Démarrer un service directement

```bash
nupo start <nom_du_service> [options]
```

| Option | Description |
|---|---|
| `-d <base>` | Nom de la base de données |
| `-u <module>` | Module à mettre à jour |
| `-i <module>` | Module à installer |
| `--stop-after-init` | Arrêter après l'initialisation |
| `--shell` | Lancer en mode shell interactif |

**Exemples :**
```bash
nupo start mon_service
nupo start mon_service -d ma_base -u mon_module
nupo start mon_service --shell
```

#### Configurer VS Code pour une version

```bash
nupo code <branche>
```

**Exemples :**
```bash
nupo code 17.0
nupo code 18.0
```

Configure automatiquement `.vscode/settings.json` et `launch.json` pour le debug Odoo, puis ouvre VS Code.

---

## Première utilisation

Au premier lancement, nupo guide à travers une étape d'initialisation :

1. Vérification de Python, pip et venv
2. Saisie du chemin vers le dépôt Odoo (source des clones)

Une fois initialisé, le menu principal donne accès à toutes les fonctionnalités.

---

## Configuration

La configuration est stockée dans `~/.nupo/config.json`.

Elle est modifiable directement via **nupo → Paramètres** :

| Paramètre | Description | Défaut |
|---|---|---|
| `odoo_path_repo` | Chemin du dépôt Odoo source | — |
| `log_buffer_size` | Nombre de lignes de logs conservées | `500` |
| `primary_color` | Couleur principale de l'interface | `#9F0C58` |
| `secondary_color` | Couleur des titres d'écran | `#E79439` |
| `text_color` | Couleur des textes secondaires | `#848484` |
| `cursor_color` | Couleur de surlignage des sélections | `cyan` |

La variable d'environnement `NUPO_CONFIG_DIR` permet de surcharger le répertoire de configuration.

---

## Mise à jour

```bash
npm update -g @y4wee/nupo
```

---

## Publier une nouvelle version (développeurs)

```bash
npm version patch   # ou minor / major
git push origin master --tags
npm publish --access=public
```

---

## Licence

MIT
