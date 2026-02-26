#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { CliStartArgs } from './types/index.js';
import { configExists, readConfig } from './services/config.js';
import { setupVsCode } from './services/ide.js';

// ── Help ─────────────────────────────────────────────────────────────────────
const rawArgs = process.argv.slice(2);
if (rawArgs[0] === '--help' || rawArgs[0] === '-h') {
  process.stdout.write(`
nupO — gestionnaire d'environnements Odoo

USAGE
  nupo                          Lance l'interface interactive
  nupo start <service> [opts]   Lance directement un service Odoo
  nupo code <branche>           Configure .vscode et ouvre VS Code

COMMANDES
  start <service>               Démarre le service nommé <service>
  code <branche>                Configure et ouvre la version Odoo dans VS Code

OPTIONS DE START
  -d <base>                     Base de données (--database)
  -u <module>                   Module à mettre à jour (--update)
  -i <module>                   Module à installer (--init)
  --stop-after-init             Arrête Odoo après l'initialisation
  --shell                       Lance en mode shell interactif

EXEMPLES
  nupo
  nupo start mon_service
  nupo start mon_service -d ma_base -u mon_module
  nupo start mon_service -d ma_base -i mon_module --stop-after-init
  nupo start mon_service --shell
  nupo code 18.0
  nupo code 17.0

`);
  process.exit(0);
}

// ── CLI argument parsing ──────────────────────────────────────────────────────
function parseCliArgs(): CliStartArgs | null {
  const args = rawArgs;
  if (args[0] !== 'start' || !args[1]) return null;

  const result: CliStartArgs = { serviceName: args[1]!, stopAfterInit: false, shell: false };

  for (let i = 2; i < args.length; i++) {
    switch (args[i]) {
      case '-d': if (args[i + 1]) result.db      = args[++i]; break;
      case '-u': if (args[i + 1]) result.module  = args[++i]; break;
      case '-i': if (args[i + 1]) result.install = args[++i]; break;
      case '--stop-after-init': result.stopAfterInit = true; break;
      case '--shell':           result.shell         = true; break;
    }
  }

  return result;
}

const startupArgs = parseCliArgs();

// ── nupo code <branch> ────────────────────────────────────────────────────────
if (rawArgs[0] === 'code') {
  const branch = rawArgs[1];
  if (!branch) {
    process.stderr.write(`nupo: usage : nupo code <branche>\n`);
    process.exit(1);
  }

  const exists = await configExists();
  if (!exists) {
    process.stderr.write(`nupo: aucune configuration trouvée. Lancez "nupo" pour initialiser.\n`);
    process.exit(1);
  }
  const cfg = await readConfig();
  if (!cfg.initiated) {
    process.stderr.write(`nupo: nupo n'est pas initialisé. Lancez "nupo" pour configurer.\n`);
    process.exit(1);
  }

  const version = (cfg.odoo_versions ?? {})[branch];
  if (!version) {
    const names = Object.keys(cfg.odoo_versions ?? {});
    const list  = names.length > 0 ? names.join(', ') : 'aucune';
    process.stderr.write(`nupo: version introuvable : "${branch}"\nVersions disponibles : ${list}\n`);
    process.exit(1);
  }

  const LABELS: Record<string, string> = {
    vscode_dir:    'Dossier .vscode',
    settings_json: 'settings.json  ',
    launch_json:   'launch.json    ',
    open_vscode:   'Ouvrir VS Code ',
  };

  const services = Object.values(cfg.odoo_services ?? {});
  const ok = await setupVsCode(version, services, (id, status, detail) => {
    const icon  = status === 'running' ? '…' : status === 'success' ? '✓' : '✗';
    const label = LABELS[id] ?? id;
    const info  = detail ? `  ${detail}` : '';
    if (status !== 'running') process.stdout.write(`${icon} ${label}${info}\n`);
  });

  process.exit(ok ? 0 : 1);
}

// ── Pre-flight validation (before alternate screen) ───────────────────────────
if (startupArgs) {
  const exists = await configExists();
  if (!exists) {
    process.stderr.write(`nupo: aucune configuration trouvée. Lancez "nupo" pour initialiser.\n`);
    process.exit(1);
  }
  const cfg = await readConfig();
  if (!cfg.initiated) {
    process.stderr.write(`nupo: nupo n'est pas initialisé. Lancez "nupo" pour configurer.\n`);
    process.exit(1);
  }
  const services = cfg.odoo_services ?? {};
  if (!services[startupArgs.serviceName]) {
    const names = Object.keys(services);
    const list  = names.length > 0 ? names.join(', ') : 'aucun';
    process.stderr.write(
      `nupo: service introuvable : "${startupArgs.serviceName}"\nServices disponibles : ${list}\n`,
    );
    process.exit(1);
  }
}

// ── Alternate screen buffer ───────────────────────────────────────────────────
// Enter alternate screen + hide cursor before rendering anything
process.stdout.write('\x1B[?1049h\x1B[?25l');

let cleanedUp = false;

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  // Restore main screen buffer + show cursor
  process.stdout.write('\x1B[?1049l\x1B[?25h');
}

// Guarantee cleanup on every possible exit path
process.on('exit',              cleanup);
process.on('SIGTERM',           () => { cleanup(); process.exit(0); });
process.on('SIGINT',            () => { cleanup(); process.exit(0); });
process.on('uncaughtException', err => {
  cleanup();
  process.stderr.write(`\nnupo: erreur non gérée : ${err.message}\n${err.stack ?? ''}\n`);
  process.exit(1);
});
process.on('unhandledRejection', reason => {
  cleanup();
  process.stderr.write(`\nnupo: promesse rejetée : ${String(reason)}\n`);
  process.exit(1);
});

// ── Render ────────────────────────────────────────────────────────────────────
let instance: ReturnType<typeof render>;

function handleExit() {
  instance.clear();
  instance.unmount();
  cleanup();
}

instance = render(<App onExit={handleExit} startupArgs={startupArgs ?? undefined} />, {
  exitOnCtrlC: false,
});

process.stdout.on('resize', () => {
  process.stdout.write('\x1B[2J\x1B[H');
});
