import type { TextDocument } from 'vscode';
import { parse } from '../format/parser';
import type { ParsedDocument } from '.';

export function parseCollieDocument(document: TextDocument): ParsedDocument {
  const { root, diagnostics } = parse(document.getText());
  return {
    ast: root,
    diagnostics,
    version: document.version
  };
}
