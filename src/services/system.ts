import { spawnSync } from 'child_process';

type RawStdin = NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };

/**
 * Temporarily suspends Ink's raw-mode and opens a file in the user's
 * preferred editor ($EDITOR / $VISUAL, fallback: nano).
 * Blocks until the editor process exits, then restores raw mode.
 */
export function openInEditor(filePath: string): void {
  const editor = process.env['EDITOR'] ?? process.env['VISUAL'] ?? 'nano';
  const stdin = process.stdin as RawStdin;

  if (stdin.isTTY) stdin.setRawMode?.(false);
  process.stdout.write('\u001B[?25h'); // ensure cursor visible

  spawnSync(editor, [filePath], { stdio: 'inherit' });

  if (stdin.isTTY) stdin.setRawMode?.(true);
}
