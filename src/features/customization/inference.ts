import type { Position, TextDocument } from 'vscode';
import { window } from 'vscode';
import type { CollieSemanticTokenType } from '../semanticTokens/legend';

const directivePattern = /@(if|elseIf|else)\b/g;
const classPattern = /\.[A-Za-z_][\w-]*/g;
const inputsFieldPattern = /^(\s*)([A-Za-z_][\w-]*)(\??)\s*:/;
const tagPattern = /^(\s*)([A-Za-z][\w-]*)/;

function isWithin(character: number, start: number, length: number): boolean {
  return character >= start && character < start + length;
}

function inferFromLine(lineText: string, character: number): CollieSemanticTokenType | undefined {
  const safeChar = Math.min(character, lineText.length);

  // Class shorthand
  classPattern.lastIndex = 0;
  let classMatch: RegExpExecArray | null;
  while ((classMatch = classPattern.exec(lineText))) {
    const start = classMatch.index;
    const length = classMatch[0].length;
    if (isWithin(safeChar, start, length)) {
      return 'collieClassShorthand';
    }
  }

  // Directives
  directivePattern.lastIndex = 0;
  let directiveMatch: RegExpExecArray | null;
  while ((directiveMatch = directivePattern.exec(lineText))) {
    const start = directiveMatch.index;
    const length = directiveMatch[0].length;
    if (isWithin(safeChar, start, length)) {
      return 'collieDirective';
    }
  }

  // Inputs field lines
  const inputsFieldMatch = inputsFieldPattern.exec(lineText);
  if (inputsFieldMatch) {
    const start = inputsFieldMatch[1].length;
    const nameLength = inputsFieldMatch[2].length;
    if (isWithin(safeChar, start, nameLength)) {
      return 'collieInputsField';
    }
  }

  // Tag name at line start (skip inputs keyword)
  const tagMatch = tagPattern.exec(lineText);
  if (tagMatch) {
    const start = tagMatch[1].length;
    const name = tagMatch[2];
    if (name !== 'inputs' && !name.startsWith('@') && isWithin(safeChar, start, name.length)) {
      return 'collieTag';
    }
  }

  return undefined;
}

function inferTokenTypeFromDocument(document: TextDocument, position: Position): CollieSemanticTokenType | undefined {
  const line = document.lineAt(position.line);
  return inferFromLine(line.text, position.character);
}

export function inferTokenTypeFromContext(): CollieSemanticTokenType | undefined {
  const editor = window.activeTextEditor;
  if (editor?.document.languageId !== 'collie') {
    return undefined;
  }

  return inferTokenTypeFromDocument(editor.document, editor.selection.active);
}
