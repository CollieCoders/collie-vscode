import type { ExtensionContext } from 'vscode';
import type { Logger } from '../logger';
import type { FeatureContext } from './types';
import { runFeature } from './helpers';

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

  await runFeature('featureFlags', registerFeatureFlagWatcher, featureContext);

  await runFeature('formatting/formatProvider', registerFormatProvider, featureContext);
  await runFeature('semanticTokens/provider', registerSemanticTokensProvider, featureContext);

  await runFeature('navigation/documentSymbols', registerDocumentSymbols, featureContext);
  await runFeature('navigation/definitionProvider', registerDefinitionProvider, featureContext);
  await runFeature('navigation/htmlToCollieDefinitionProvider', registerHtmlToCollieDefinitionProvider, featureContext);
  await runFeature('navigation/commands', registerNavigationCommands, featureContext);

  await runFeature('diagnostics/provider', registerDiagnosticsProvider, featureContext);
  await runFeature('diagnostics/codeActions', registerDiagnosticsCodeActions, featureContext);
  await runFeature('diagnostics/tsInputsDiagnostics', registerTsInputsDiagnostics, featureContext);

  await runFeature('hover/provider', registerHoverProvider, featureContext);

  await runFeature('completions/provider', registerCompletionsProvider, featureContext);
  await runFeature('completions/collieIdProvider', registerCollieIdCompletionProvider, featureContext);
  await runFeature('completions/htmlCollieIdProvider', registerHtmlCollieIdProvider, featureContext);

  await runFeature('symbols/workspaceSymbolProvider', registerWorkspaceSymbolProvider, featureContext);

  await runFeature('lang/templateIndex', registerTemplateIndex, featureContext);
  await runFeature('lang/cacheWatcher', registerLangCacheWatcher, featureContext);

  await runFeature('config/discovery', registerConfigDiscovery, featureContext);

  await runFeature('css/indexer', registerCssIndexer, featureContext);
  await runFeature('css/commands', registerCssCommands, featureContext);

  await runFeature('customization/commands', registerCustomizationCommands, featureContext);

  await runFeature('conversion/commands', registerConversionCommands, featureContext);
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
import { registerTsInputsDiagnostics } from './diagnostics/tsInputsDiagnostics';

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
