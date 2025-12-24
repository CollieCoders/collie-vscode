import { languages, Location, Position, Range, SymbolInformation, SymbolKind, type CancellationToken } from 'vscode';
import * as path from 'path';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { getAllTemplateIds } from '../../lang/cache';
import { isFeatureFlagEnabled } from '../featureFlags';

/**
 * Converts a SourceSpan to a VS Code Range.
 */
function sourceSpanToRange(span: { start: { line: number; col: number }; end: { line: number; col: number } }): Range {
  return new Range(
    new Position(span.start.line, span.start.col),
    new Position(span.end.line, span.end.col)
  );
}

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
    const templateIds = getAllTemplateIds();
    const symbols: SymbolInformation[] = [];
    
    // Normalize query for case-insensitive filtering
    const normalizedQuery = query.toLowerCase().trim();
    
    for (const [logicalId, entries] of templateIds.entries()) {
      // Filter by query if provided
      if (normalizedQuery && !logicalId.toLowerCase().includes(normalizedQuery)) {
        continue;
      }
      
      for (const entry of entries) {
        // Determine the location to jump to
        let location: Location;
        
        if (entry.idSpan) {
          // Jump to explicit ID directive
          const range = sourceSpanToRange(entry.idSpan);
          location = new Location(entry.uri, range);
        } else {
          // Jump to top of file for implicit ID
          location = new Location(entry.uri, new Position(0, 0));
        }
        
        // Create symbol information
        // Using SymbolKind.Class for templates (could also be Function or Object)
        const containerName = path.basename(entry.uri.fsPath);
        
        const symbol = new SymbolInformation(
          entry.id,
          SymbolKind.Class,
          containerName,
          location
        );
        
        symbols.push(symbol);
      }
    }
    
    return symbols;
  } catch (error) {
    context.logger.error('Collie workspace symbol provider failed.', error);
    return [];
  }
}

function activateCollieWorkspaceSymbolProvider(context: FeatureContext) {
  const provider = languages.registerWorkspaceSymbolProvider({
    provideWorkspaceSymbols(query, token) {
      return provideCollieWorkspaceSymbols(query, token, context);
    }
  });
  
  context.register(provider);
  context.logger.info('Collie workspace symbol provider registered.');
}

registerFeature(activateCollieWorkspaceSymbolProvider);
