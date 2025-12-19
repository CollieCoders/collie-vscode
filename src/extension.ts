import type { ExtensionContext } from 'vscode';
import { activateFeatures } from './features';
import { createLogger } from './logger';

export async function activate(context: ExtensionContext) {
  const logger = createLogger();
  context.subscriptions.push(logger);

  logger.info('Collie extension activating');

  await activateFeatures(context, logger);

  logger.info('Collie extension activated.');
}

export function deactivate() {
  // No-op; VS Code handles teardown.
}
