import { languages } from 'vscode';
import type { TextDocument, FormattingOptions, CancellationToken } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { formatDocument } from '../../format/formatter';

async function provideFormattingEdits(
  document: TextDocument,
  _options: FormattingOptions,
  _token: CancellationToken,
  ctx: FeatureContext
) {
  try {
    const result = formatDocument(document);
    return result.edits;
  } catch (error) {
    ctx.logger.warn('Collie formatter failed; returning no edits.', error);
    return [];
  }
}

function activateFormattingFeature(ctx: FeatureContext) {
  const provider = languages.registerDocumentFormattingEditProvider({ language: 'collie' }, {
    provideDocumentFormattingEdits(document, options, token) {
      return provideFormattingEdits(document, options, token, ctx);
    }
  });

  ctx.register(provider);
  ctx.logger.info('Collie document formatter registered.');
}

registerFeature(activateFormattingFeature);
