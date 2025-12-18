import type { ExtensionContext } from 'vscode';
import { activateFeatures } from './features';
import { createLogger } from './logger';

export async function activate(context: ExtensionContext) {
  console.log('Collie extension activating');

  const logger = createLogger();
  context.subscriptions.push(logger);

  await activateFeatures(context, logger);

  logger.info('Collie extension activated.');
}

export function deactivate() {
  console.log('Collie extension deactivated');
}
