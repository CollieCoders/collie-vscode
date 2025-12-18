import type { Disposable, ExtensionContext } from 'vscode';
import type { Logger } from '../logger';

export interface FeatureContext {
  readonly extensionContext: ExtensionContext;
  readonly logger: Logger;
  register<T extends Disposable>(disposable: T): T;
}

export type FeatureRegistration = (context: FeatureContext) => void | Promise<void>;

const featureRegistry: FeatureRegistration[] = [];

export function registerFeature(registration: FeatureRegistration) {
  featureRegistry.push(registration);
}

export async function activateFeatures(extensionContext: ExtensionContext, logger: Logger) {
  const featureContext: FeatureContext = {
    extensionContext,
    logger,
    register(disposable) {
      extensionContext.subscriptions.push(disposable);
      return disposable;
    }
  };

  for (const registration of featureRegistry) {
    await registration(featureContext);
  }
}

// Ensure built-in feature modules register themselves when this module loads.
import './featureFlags';
import './formatting/formatProvider';
import './semanticTokens/provider';
import './navigation/documentSymbols';
import './navigation/definitionProvider';
import './diagnostics/provider';
import './hover/provider';
import './completions/provider';
import './lang/cacheWatcher';
import './customization/commands';
