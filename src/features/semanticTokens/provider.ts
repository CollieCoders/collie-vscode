import { languages, SemanticTokensBuilder } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { collieSemanticTokensLegend } from './legend';
import { tokenizeCollieSemanticTokens } from './tokenize';

async function registerCollieSemanticTokens(context: FeatureContext) {
  const provider = languages.registerDocumentSemanticTokensProvider(
    { language: 'collie' },
    {
      async provideDocumentSemanticTokens(document) {
        const builder = new SemanticTokensBuilder(collieSemanticTokensLegend);
        const tokens = tokenizeCollieSemanticTokens(document.getText());

        for (const token of tokens) {
          builder.push(token.line, token.startCharacter, token.length, token.type, []);
        }

        return builder.build();
      }
    },
    collieSemanticTokensLegend
  );

  context.register(provider);
  context.logger.info('Collie semantic tokens provider registered.');
}

registerFeature(registerCollieSemanticTokens);
