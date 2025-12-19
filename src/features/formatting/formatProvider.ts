import { languages, workspace } from 'vscode';
import type { TextDocument, FormattingOptions, CancellationToken } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { formatDocument } from '../../format/formatter';
import type { FormatterOptions } from '../../format/formatter';

function readFormatterOptions(): FormatterOptions {
  const config = workspace.getConfiguration('collie');
  return {
    indentSize: Math.max(1, config.get<number>('format.indentSize', 2)),
    preferCompactSelectors: config.get<boolean>('format.preferCompactSelectors', true),
    spaceAroundPipe: config.get<boolean>('format.spaceAroundPipe', true),
    normalizePropsSpacing: config.get<boolean>('format.normalizePropsSpacing', true)
  };
}

async function provideFormattingEdits(
  document: TextDocument,
  _options: FormattingOptions,
  token: CancellationToken,
  ctx: FeatureContext
) {
  try {
    if (token.isCancellationRequested) {
      return [];
    }

    const result = formatDocument(document, readFormatterOptions());

    if (token.isCancellationRequested) {
      return [];
    }

    if (result.usedFallback) {
      ctx.logger.warn('Collie AST formatter failed; fallback formatter applied.', result.error);
    }
    return result.edits;
  } catch (error) {
    ctx.logger.warn('Collie formatter failed; returning no edits.', error);
    return [];
  }
}

function activateFormattingFeature(ctx: FeatureContext) {
  const provider = languages.registerDocumentFormattingEditProvider(
    { language: 'collie' },
    {
      provideDocumentFormattingEdits(document, options, token) {
        return provideFormattingEdits(document, options, token, ctx);
      }
    }
  );

  ctx.register(provider);
  ctx.logger.info('Collie document formatter registered.');
}

registerFeature(activateFormattingFeature);
