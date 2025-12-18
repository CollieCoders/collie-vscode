import { languages, SemanticTokensBuilder } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { collieSemanticTokensLegend } from './legend';

async function registerCollieSemanticTokens(context: FeatureContext) {
  const provider = languages.registerDocumentSemanticTokensProvider(
    { language: 'collie' },
    {
      async provideDocumentSemanticTokens() {
        const builder = new SemanticTokensBuilder(collieSemanticTokensLegend);
        return builder.build();
      }
    },
    collieSemanticTokensLegend
  );

  context.register(provider);
  context.logger.info('Collie semantic tokens provider registered.');
}

registerFeature(registerCollieSemanticTokens);
