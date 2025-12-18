import type { SemanticTokens, TextDocument } from 'vscode';
import { languages, SemanticTokensBuilder, workspace } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { collieSemanticTokensLegend } from './legend';
import { tokenizeCollieSemanticTokens } from './tokenize';
import type { CollieSemanticToken } from './tokenize';

interface TokenCacheEntry {
  version: number;
  tokens: CollieSemanticToken[];
  semanticTokens?: SemanticTokens;
}

const tokenCache = new Map<string, TokenCacheEntry>();

function getDocumentCacheKey(document: TextDocument): string {
  return document.uri.toString();
}

function isSemanticTokensEnabled(): boolean {
  return workspace.getConfiguration('collie').get<boolean>('semanticTokens.enabled', true);
}

function buildSemanticTokens(tokens: CollieSemanticToken[]): SemanticTokens {
  const builder = new SemanticTokensBuilder(collieSemanticTokensLegend);
  for (const token of tokens) {
    builder.push(token.line, token.startCharacter, token.length, token.type, []);
  }
  return builder.build();
}

function getOrCreateCacheEntry(document: TextDocument): TokenCacheEntry {
  const cacheKey = getDocumentCacheKey(document);
  const existing = tokenCache.get(cacheKey);
  if (existing && existing.version === document.version) {
    return existing;
  }

  const tokens = tokenizeCollieSemanticTokens(document.getText());
  const entry: TokenCacheEntry = {
    version: document.version,
    tokens
  };
  tokenCache.set(cacheKey, entry);
  return entry;
}

function getSemanticTokens(document: TextDocument): SemanticTokens {
  const entry = getOrCreateCacheEntry(document);
  if (!entry.semanticTokens) {
    entry.semanticTokens = buildSemanticTokens(entry.tokens);
  }
  return entry.semanticTokens;
}

function buildRangeTokens(tokens: CollieSemanticToken[], startLine: number, endLine: number): SemanticTokens {
  const builder = new SemanticTokensBuilder(collieSemanticTokensLegend);
  for (const token of tokens) {
    if (token.line < startLine || token.line > endLine) {
      continue;
    }
    builder.push(token.line, token.startCharacter, token.length, token.type, []);
  }
  return builder.build();
}

async function registerCollieSemanticTokens(context: FeatureContext) {
  const provider = languages.registerDocumentSemanticTokensProvider(
    { language: 'collie' },
    {
      async provideDocumentSemanticTokens(document) {
        if (!isSemanticTokensEnabled()) {
          return new SemanticTokensBuilder(collieSemanticTokensLegend).build();
        }
        return getSemanticTokens(document);
      }
    },
    collieSemanticTokensLegend
  );

  const rangeProvider = languages.registerDocumentRangeSemanticTokensProvider(
    { language: 'collie' },
    {
      async provideDocumentRangeSemanticTokens(document, range) {
        if (!isSemanticTokensEnabled()) {
          return new SemanticTokensBuilder(collieSemanticTokensLegend).build();
        }
        const entry = getOrCreateCacheEntry(document);
        return buildRangeTokens(entry.tokens, range.start.line, range.end.line);
      }
    },
    collieSemanticTokensLegend
  );

  const configurationListener = workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('collie.semanticTokens.enabled')) {
      tokenCache.clear();
      context.logger.info('Collie semantic tokens setting changed; cache cleared.');
    }
  });

  const closeListener = workspace.onDidCloseTextDocument(document => {
    tokenCache.delete(getDocumentCacheKey(document));
  });

  context.register(provider);
  context.register(rangeProvider);
  context.register(configurationListener);
  context.register(closeListener);
  context.logger.info('Collie semantic tokens provider registered.');
}

registerFeature(registerCollieSemanticTokens);
