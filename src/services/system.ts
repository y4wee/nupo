import { spawnSync } from 'child_process';

type RawStdin = NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };

/**
 * Temporarily suspends Ink's raw-mode and opens a file in the user's
 * preferred editor ($EDITOR / $VISUAL, fallback: nano).
 * Blocks until the editor process exits, then restores raw mode.
 */
function withRawModeDisabled(fn: () => void): void {
  const stdin = process.stdin as RawStdin;
  if (stdin.isTTY) stdin.setRawMode?.(false);
  process.stdout.write('\u001B[?25h'); // ensure cursor visible
  fn();
  if (stdin.isTTY) stdin.setRawMode?.(true);
}

export function openInEditor(filePath: string): void {
  const editor = process.env['EDITOR'] ?? process.env['VISUAL'] ?? 'nano';
  withRawModeDisabled(() => spawnSync(editor, [filePath], { stdio: 'inherit' }));
}

export function runInTerminal(cmd: string, args: string[]): void {
  withRawModeDisabled(() => spawnSync(cmd, args, { stdio: 'inherit' }));
}

export function copyToClipboard(text: string): boolean {
  // macOS
  if (process.platform === 'darwin') {
    return spawnSync('pbcopy', [], { input: text }).status === 0;
  }
  // Wayland
  if (process.env['WAYLAND_DISPLAY']) {
    if (spawnSync('wl-copy', [], { input: text }).status === 0) return true;
  }
  // X11
  if (spawnSync('xclip', ['-selection', 'clipboard'], { input: text }).status === 0) return true;
  if (spawnSync('xsel', ['--clipboard', '--input'], { input: text }).status === 0) return true;
  return false;
}
