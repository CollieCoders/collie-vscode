import type { TextDocument } from 'vscode';
import { Range, TextEdit } from 'vscode';
import { parse } from './parser';
import { print } from './printer/print';

export interface FormatterResult {
  edits: TextEdit[];
}

export function formatDocument(document: TextDocument): FormatterResult {
  const text = document.getText();
  const { root } = parse(text);
  const formatted = print(root, {});

  const fullRange = new Range(document.positionAt(0), document.positionAt(text.length));
  return {
    edits: [TextEdit.replace(fullRange, formatted)]
  };
}
