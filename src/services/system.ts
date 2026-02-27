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
  const isMac = process.platform === 'darwin';
  if (isMac) {
    const r = spawnSync('pbcopy', [], { input: text });
    return r.status === 0;
  }
  // Linux: try xclip then xsel
  let r = spawnSync('xclip', ['-selection', 'clipboard'], { input: text });
  if (r.status === 0) return true;
  r = spawnSync('xsel', ['--clipboard', '--input'], { input: text });
  return r.status === 0;
}
