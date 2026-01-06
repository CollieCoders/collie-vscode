import { Position, Range, type TextDocument } from 'vscode';
import type { SourceSpan } from '../../../format/parser/diagnostics';

export function spanToRange(document: TextDocument, span?: SourceSpan): Range {
  if (!span) {
    return new Range(0, 0, 0, 0);
  }
  const start = spanPositionToVs(document, span.start);
  const end = spanPositionToVs(document, span.end);
  return new Range(start, end);
}

export function spanPositionToVs(document: TextDocument, pos: SourceSpan['start']): Position {
  const lineIndex = Math.min(
    Math.max(pos.line - 1, 0),
    Math.max(document.lineCount - 1, 0)
  );
  const lineText = document.lineAt(lineIndex).text;
  const character = Math.min(Math.max(pos.col - 1, 0), lineText.length);
  return new Position(lineIndex, character);
}
