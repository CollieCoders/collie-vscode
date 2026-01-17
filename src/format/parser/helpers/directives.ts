import type { ConditionalBranch, ConditionalNode, ForLoopNode } from '../ast';
import type { Diagnostic } from '../diagnostics';
import { createSpan } from '../diagnostics';
import type { ConditionalBranchContext, ConditionalChainState, ConditionalHeaderResult } from '../types';
import { pushDiag } from './errors';

export function cleanupConditionalChains(state: Map<number, ConditionalChainState>, level: number): void {
  for (const key of Array.from(state.keys())) {
    if (key > level) {
      state.delete(key);
    }
  }
}

export function parseConditionalHeader(
  kind: 'if' | 'elseIf',
  lineContent: string,
  lineNumber: number,
  column: number,
  lineOffset: number,
  diagnostics: Diagnostic[]
): ConditionalHeaderResult | null {
  const trimmed = lineContent.trimEnd();
  const pattern = kind === 'if' ? /^@if\s*\((.*)\)(.*)$/ : /^@elseIf\s*\((.*)\)(.*)$/;
  const match = trimmed.match(pattern);
  if (!match) {
    pushDiag(
      diagnostics,
      'COLLIE201',
      kind === 'if' ? 'Invalid @if syntax. Use @if (condition).' : 'Invalid @elseIf syntax. Use @elseIf (condition).',
      lineNumber,
      column,
      lineOffset,
      trimmed.length || 3
    );
    return null;
  }
  const test = match[1].trim();
  if (!test) {
    pushDiag(
      diagnostics,
      'COLLIE201',
      kind === 'if' ? '@if condition cannot be empty.' : '@elseIf condition cannot be empty.',
      lineNumber,
      column,
      lineOffset,
      trimmed.length || 3
    );
    return null;
  }
  const remainderRaw = match[2] ?? '';
  const inlineBody = remainderRaw.trim();
  const remainderOffset = trimmed.length - remainderRaw.length;
  const leadingWhitespace = remainderRaw.length - inlineBody.length;
  const inlineColumn =
    inlineBody.length > 0 ? column + remainderOffset + leadingWhitespace : undefined;
  return {
    test,
    inlineBody: inlineBody.length ? inlineBody : undefined,
    inlineColumn,
    span: createSpan(lineNumber, column, Math.max(trimmed.length, 1), lineOffset)
  };
}

export function parseElseHeader(
  lineContent: string,
  lineNumber: number,
  column: number,
  lineOffset: number,
  diagnostics: Diagnostic[]
): ConditionalHeaderResult | null {
  const trimmed = lineContent.trimEnd();
  const match = trimmed.match(/^@else\b(.*)$/);
  if (!match) {
    pushDiag(
      diagnostics,
      'COLLIE203',
      'Invalid @else syntax.',
      lineNumber,
      column,
      lineOffset,
      trimmed.length || 4
    );
    return null;
  }
  const remainderRaw = match[1] ?? '';
  const inlineBody = remainderRaw.trim();
  const remainderOffset = trimmed.length - remainderRaw.length;
  const leadingWhitespace = remainderRaw.length - inlineBody.length;
  const inlineColumn =
    inlineBody.length > 0 ? column + remainderOffset + leadingWhitespace : undefined;
  return {
    inlineBody: inlineBody.length ? inlineBody : undefined,
    inlineColumn,
    span: createSpan(lineNumber, column, Math.max(trimmed.length, 1), lineOffset)
  };
}

export function parseForLoop(
  trimmed: string,
  lineNumber: number,
  column: number,
  lineOffset: number,
  diagnostics: Diagnostic[]
): ForLoopNode | null {
  const match = trimmed.match(/^@for\s+([A-Za-z_][\w]*)\s+in\s+([A-Za-z_][\w.[\]]*)/);
  if (!match) {
    pushDiag(
      diagnostics,
      'COLLIE210',
      'Invalid @for syntax. Use @for variable in iterable',
      lineNumber,
      column,
      lineOffset,
      trimmed.length
    );
    return null;
  }

  const variable = match[1];
  const iterable = match[2];

  return {
    type: 'ForLoop',
    variable,
    iterable,
    body: [],
    span: createSpan(lineNumber, column, trimmed.length, lineOffset)
  };
}

export function createConditionalBranchContext(
  owner: ConditionalNode,
  branch: ConditionalBranch
): ConditionalBranchContext {
  return {
    kind: 'ConditionalBranch',
    owner,
    branch,
    children: branch.body
  };
}
