import type { Disposable, ExtensionContext } from 'vscode';
import type { Logger } from '../logger';

export interface FeatureContext {
  readonly extensionContext: ExtensionContext;
  readonly logger: Logger;
  register<T extends Disposable>(disposable: T): T;
}

export type FeatureRegistration = (context: FeatureContext) => void | Promise<void>;

export async function activateFeatures(
  extensionContext: ExtensionContext,
  logger: Logger
): Promise<void> {
  const featureContext: FeatureContext = {
    extensionContext,
    logger,
    register(disposable) {
      extensionContext.subscriptions.push(disposable);
      return disposable;
    }
  };

  async function runFeature(name: string, fn: FeatureRegistration) {
    try {
      const result = fn(featureContext);
      if (result && typeof (result as Promise<void>).then === 'function') {
        await result;
      }
    } catch (error) {
      logger.error(`Collie feature activation failed (${name}).`, error);
    }
  }

  await runFeature('featureFlags', registerFeatureFlagWatcher);

  await runFeature('formatting/formatProvider', registerFormatProvider);
  await runFeature('semanticTokens/provider', registerSemanticTokensProvider);

  await runFeature('navigation/documentSymbols', registerDocumentSymbols);
  await runFeature('navigation/definitionProvider', registerDefinitionProvider);
  await runFeature('navigation/htmlToCollieDefinitionProvider', registerHtmlToCollieDefinitionProvider);
  await runFeature('navigation/commands', registerNavigationCommands);

  await runFeature('diagnostics/provider', registerDiagnosticsProvider);
  await runFeature('diagnostics/codeActions', registerDiagnosticsCodeActions);
  await runFeature('diagnostics/tsPropsDiagnostics', registerTsPropsDiagnostics);

  await runFeature('hover/provider', registerHoverProvider);

  await runFeature('completions/provider', registerCompletionsProvider);
  await runFeature('completions/collieIdProvider', registerCollieIdCompletionProvider);
  await runFeature('completions/htmlCollieIdProvider', registerHtmlCollieIdProvider);

  await runFeature('symbols/workspaceSymbolProvider', registerWorkspaceSymbolProvider);

  await runFeature('lang/templateIndex', registerTemplateIndex);
  await runFeature('lang/cacheWatcher', registerLangCacheWatcher);

  await runFeature('config/discovery', registerConfigDiscovery);

  await runFeature('css/indexer', registerCssIndexer);
  await runFeature('css/commands', registerCssCommands);

  await runFeature('customization/commands', registerCustomizationCommands);

  await runFeature('conversion/commands', registerConversionCommands);
}

import { registerFeatureFlagWatcher } from './featureFlags';

import { registerFormatProvider } from './formatting/formatProvider';
import { registerSemanticTokensProvider } from './semanticTokens/provider';

import { registerDocumentSymbols } from './navigation/documentSymbols';
import { registerDefinitionProvider } from './navigation/definitionProvider';
import { registerHtmlToCollieDefinitionProvider } from './navigation/htmlToCollieDefinitionProvider';
import { registerNavigationCommands } from './navigation/commands';

import { registerDiagnosticsProvider } from './diagnostics/provider';
import { registerDiagnosticsCodeActions } from './diagnostics/codeActions';
import { registerTsPropsDiagnostics } from './diagnostics/tsPropsDiagnostics';

import { registerHoverProvider } from './hover/provider';

import { registerCompletionsProvider } from './completions/provider';
import { registerCollieIdCompletionProvider } from './completions/collieIdProvider';
import { registerHtmlCollieIdProvider } from './completions/htmlCollieIdProvider';

import { registerWorkspaceSymbolProvider } from './symbols/workspaceSymbolProvider';

import { registerTemplateIndex } from '../lang/templateIndex';
import { registerLangCacheWatcher } from './lang/cacheWatcher';

import { registerConfigDiscovery } from './config/discovery';

import { registerCssIndexer } from './css/indexer';
import { registerCssCommands } from './css/commands';

import { registerCustomizationCommands } from './customization/commands';

import { registerConversionCommands } from './conversion/commands';
