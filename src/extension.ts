import type { ExtensionContext } from 'vscode';
import { activateFeatures } from './features';
import { createLogger } from './logger';

async function activate(context: ExtensionContext) {
  const logger = createLogger();

  if (Array.isArray(context?.subscriptions)) {
    context.subscriptions.push(logger);
  } else {
    console.error('[Collie] ExtensionContext.subscriptions is missing/invalid:', context);
  }

  logger.info('Collie activating...');

  await activateFeatures(context, logger);

  logger.info('Collie activated.');
}

function deactivate() {
  // No-op; VS Code handles teardown.
}

module.exports = { activate, deactivate };
