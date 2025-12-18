import type { TextDocument } from 'vscode';
import { Range, TextEdit } from 'vscode';
import { fallbackFormat } from './fallback';
import { parse } from './parser';
import type { PrintOptions } from './printer/print';
import { print } from './printer/print';

export interface FormatterOptions extends Required<Pick<PrintOptions, 'indentSize' | 'preferCompactSelectors' | 'spaceAroundPipe' | 'normalizePropsSpacing'>> {}

export interface FormatterResult {
  edits: TextEdit[];
  usedFallback: boolean;
  error?: unknown;
}

const DEFAULT_FORMATTER_OPTIONS: FormatterOptions = {
  indentSize: 2,
  preferCompactSelectors: true,
  spaceAroundPipe: true,
  normalizePropsSpacing: true
};

export function formatDocument(document: TextDocument, options: FormatterOptions = DEFAULT_FORMATTER_OPTIONS): FormatterResult {
  const resolved: FormatterOptions = {
    indentSize: Math.max(1, options.indentSize),
    preferCompactSelectors: options.preferCompactSelectors,
    spaceAroundPipe: options.spaceAroundPipe,
    normalizePropsSpacing: options.normalizePropsSpacing
  };

  const text = document.getText();
  const fullRange = new Range(document.positionAt(0), document.positionAt(text.length));

  try {
    const { root } = parse(text);
    const formatted = print(root, resolved);
    if (formatted === text) {
      return { edits: [], usedFallback: false };
    }
    return {
      edits: [TextEdit.replace(fullRange, formatted)],
      usedFallback: false
    };
  } catch (error) {
    const fallback = fallbackFormat(text, { indentSize: resolved.indentSize });
    if (fallback === text) {
      return { edits: [], usedFallback: true, error };
    }
    return {
      edits: [TextEdit.replace(fullRange, fallback)],
      usedFallback: true,
      error
    };
  }
}
