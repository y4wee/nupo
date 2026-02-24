export interface OdooVersion {
  branch: string;
  path: string;
}

export interface PendingInstall {
  branch: string;
  path: string;
  lastCompletedStep: InstallStepId | null;
}

export interface NupoConfig {
  initiated: boolean;
  python_installed: boolean;
  pip_installed: boolean;
  odoo_path_repo: string;
  odoo_versions: Record<string, OdooVersion>;
  pending_installs?: Record<string, PendingInstall>;
}

export const DEFAULT_CONFIG: NupoConfig = {
  initiated: false,
  python_installed: false,
  pip_installed: false,
  odoo_path_repo: '',
  odoo_versions: {},
  pending_installs: {},
};

export type Screen = 'home' | 'init' | 'odoo' | 'config';
export type StepStatus = 'pending' | 'running' | 'success' | 'error';
export type InitStepId = 'python' | 'pip' | 'odoo_path';

export interface InitStep {
  id: InitStepId;
  label: string;
  status: StepStatus;
  errorMessage?: string;
}

export type InstallStepId =
  | 'branch_input'
  | 'check_community'
  | 'check_enterprise'
  | 'create_dir'
  | 'clone_community'
  | 'clone_enterprise'
  | 'create_venv'
  | 'install_requirements'
  | 'create_extras';

export interface InstallStep {
  id: InstallStepId;
  label: string;
  status: StepStatus;
  errorMessage?: string;
}

/** Structural type accepted by StepsPanel / ErrorPanel */
export interface AnyStep {
  id: string;
  label: string;
  status: StepStatus;
  errorMessage?: string;
}

export interface MenuOption {
  id: string;
  label: string;
  description: string;
  screen: Screen;
  visible: boolean;
}
