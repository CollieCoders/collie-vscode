import { languages, Location, SymbolInformation, SymbolKind, type CancellationToken } from 'vscode';
import * as path from 'path';
import type { FeatureContext } from '..';
import { getById, listIds } from '../../lang/templateIndex';
import { isFeatureFlagEnabled } from '../featureFlags';

/**
 * Provides workspace symbols for Collie templates, allowing users to search
 * and navigate to templates via "Go to Symbol in Workspace" (Cmd/Ctrl+T).
 */
function provideCollieWorkspaceSymbols(
  query: string,
  token: CancellationToken,
  context: FeatureContext
): SymbolInformation[] {
  if (!isFeatureFlagEnabled('navigation')) {
    return [];
  }

  try {
    const symbols: SymbolInformation[] = [];
    const templateIds = listIds();
    const normalizedQuery = query.toLowerCase().trim();
    for (const logicalId of templateIds) {
      if (normalizedQuery && !logicalId.toLowerCase().includes(normalizedQuery)) {
        continue;
      }

      const entry = getById(logicalId);
      if (!entry) {
        continue;
      }

      const location = new Location(entry.uri, entry.idRange);
      const containerName = path.basename(entry.uri.fsPath);
      const symbol = new SymbolInformation(logicalId, SymbolKind.Function, containerName, location);
      symbols.push(symbol);
    }

    return symbols;
  } catch (error) {
    context.logger.error('Collie workspace symbol provider failed.', error);
    return [];
  }
}

export function registerWorkspaceSymbolProvider(context: FeatureContext) {
  const provider = languages.registerWorkspaceSymbolProvider({
    provideWorkspaceSymbols(query, token) {
      return provideCollieWorkspaceSymbols(query, token, context);
    }
  });

  context.register(provider);
  context.logger.info('Collie workspace symbol provider registered.');
}
