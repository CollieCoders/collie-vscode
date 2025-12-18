import type { Disposable } from 'vscode';
import { workspace } from 'vscode';

export interface Logger extends Disposable {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
  debug?(message: string, ...meta: unknown[]): void;
}

const CONFIG_KEY = 'collie.logging.enabled';

function readLoggingSetting(): boolean {
  return workspace.getConfiguration().get<boolean>(CONFIG_KEY, false);
}

function formatMessage(message: string): string {
  return `[Collie] ${message}`;
}

export function createLogger(): Logger {
  let isEnabled = readLoggingSetting();

  const configListener = workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration(CONFIG_KEY)) {
      isEnabled = readLoggingSetting();
    }
  });

  const log = (method: 'log' | 'warn' | 'error', message: string, meta: unknown[]) => {
    if (!isEnabled && method === 'log') {
      return;
    }

    const formatted = formatMessage(message);
    console[method](formatted, ...meta);
  };

  return {
    info(message, ...meta) {
      log('log', message, meta);
    },
    warn(message, ...meta) {
      log('warn', message, meta);
    },
    error(message, ...meta) {
      log('error', message, meta);
    },
    dispose() {
      configListener.dispose();
    }
  };
}
