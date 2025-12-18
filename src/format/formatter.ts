import type { TextDocument } from 'vscode';
import { Range, TextEdit } from 'vscode';
import { fallbackFormat } from './fallback';
import { parse } from './parser';
import { print } from './printer/print';

export interface FormatterResult {
  edits: TextEdit[];
  usedFallback: boolean;
  error?: unknown;
}

export function formatDocument(document: TextDocument): FormatterResult {
  const text = document.getText();
  const fullRange = new Range(document.positionAt(0), document.positionAt(text.length));

  try {
    const { root } = parse(text);
    const formatted = print(root, {});
    if (formatted === text) {
      return { edits: [], usedFallback: false };
    }
    return {
      edits: [TextEdit.replace(fullRange, formatted)],
      usedFallback: false
    };
  } catch (error) {
    const fallback = fallbackFormat(text, { indentSize: 2 });
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
