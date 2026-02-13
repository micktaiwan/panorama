/**
 * Shell execution — desktop only (Tauri plugin-shell)
 */
import { isTauri } from './detect';

export interface ShellOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Execute a shell command via Tauri's shell plugin.
 * Returns null on web (not available).
 */
export async function execCommand(command: string): Promise<ShellOutput | null> {
  if (!isTauri()) return null;

  try {
    const { Command } = await import('@tauri-apps/plugin-shell');
    const cmd = Command.create('exec-sh', ['-c', command]);
    const output = await cmd.execute();
    return {
      code: output.code,
      stdout: output.stdout,
      stderr: output.stderr,
    };
  } catch (err) {
    console.error('Shell exec error:', err);
    return { code: -1, stdout: '', stderr: String(err) };
  }
}

/**
 * Spawn an interactive shell command with streaming output.
 * Returns a child process handle, or null on web.
 */
export async function spawnCommand(
  command: string,
  onStdout: (data: string) => void,
  onStderr: (data: string) => void,
  onClose: (code: number | null) => void,
) {
  if (!isTauri()) return null;

  const { Command } = await import('@tauri-apps/plugin-shell');
  const cmd = Command.create('exec-sh', ['-c', command]);

  cmd.on('close', (ev) => onClose(ev.code));
  cmd.stdout.on('data', (line) => onStdout(line));
  cmd.stderr.on('data', (line) => onStderr(line));

  const child = await cmd.spawn();
  return child;
}
