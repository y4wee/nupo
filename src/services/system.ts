import { spawnSync } from 'child_process';
import { openSync, writeSync, closeSync } from 'fs';
import clipboard from 'clipboardy';

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
  // Try native clipboard tools via clipboardy (xclip, xsel, wl-copy, pbcopy…)
  try {
    clipboard.writeSync(text);
    return true;
  } catch { /* no native tool available, fall through */ }

  // Fallback: OSC 52 written directly to /dev/tty, bypassing Ink's stdout
  try {
    const b64 = Buffer.from(text).toString('base64');
    const seq = `\x1b]52;c;${b64}\x07`;
    const fd = openSync('/dev/tty', 'w');
    writeSync(fd, seq);
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}
