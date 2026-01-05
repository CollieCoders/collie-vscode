import type { ExpressionNode, Node, TextNode } from '../ast';
import type { Diagnostic, SourceSpan } from '../diagnostics';
import { createSpan } from '../diagnostics';
import { pushDiag } from './errors';

export function parseTextPayload(
  payload: string,
  lineNumber: number,
  payloadColumn: number,
  lineOffset: number,
  diagnostics: Diagnostic[]
): TextNode['parts'] {
  const parts: TextNode['parts'] = [];
  let cursor = 0;

  while (cursor < payload.length) {
    const nextDoubleOpen = payload.indexOf('{{', cursor);
    const nextSingleOpen = payload.indexOf('{', cursor);
    const nextClose = payload.indexOf('}}', cursor);

    // Determine which opening brace comes first
    let nextOpen = -1;
    let isSingleBrace = false;
    
    if (nextSingleOpen !== -1 && nextDoubleOpen !== -1) {
      if (nextSingleOpen < nextDoubleOpen) {
        nextOpen = nextSingleOpen;
        isSingleBrace = true;
      } else {
        nextOpen = nextDoubleOpen;
        isSingleBrace = false;
      }
    } else if (nextSingleOpen !== -1) {
      nextOpen = nextSingleOpen;
      isSingleBrace = true;
    } else if (nextDoubleOpen !== -1) {
      nextOpen = nextDoubleOpen;
      isSingleBrace = false;
    }

    if (nextClose !== -1 && (nextOpen === -1 || nextClose < nextOpen)) {
      const leadingText = payload.slice(cursor, nextClose);
      if (leadingText.length) {
        parts.push({ type: 'text', value: leadingText });
      }
      pushDiag(
        diagnostics,
        'COLLIE005',
        'Inline expression closing }} must follow an opening {{.',
        lineNumber,
        payloadColumn + nextClose,
        lineOffset,
        2
      );
      cursor = nextClose + 2;
      continue;
    }

    if (nextOpen === -1) {
      const text = payload.slice(cursor);
      if (text.length) {
        parts.push({ type: 'text', value: text });
      }
      break;
    }

    if (nextOpen > cursor) {
      parts.push({ type: 'text', value: payload.slice(cursor, nextOpen) });
    }

    if (isSingleBrace) {
      // Handle single brace {expr}
      const exprEnd = payload.indexOf('}', nextOpen + 1);
      if (exprEnd === -1) {
        pushDiag(
          diagnostics,
          'COLLIE005',
          'Inline expression must end with }.',
          lineNumber,
          payloadColumn + nextOpen,
          lineOffset
        );
        const remainder = payload.slice(nextOpen);
        if (remainder.length) {
          parts.push({ type: 'text', value: remainder });
        }
        break;
      }

      const inner = payload.slice(nextOpen + 1, exprEnd).trim();
      if (!inner) {
        pushDiag(
          diagnostics,
          'COLLIE005',
          'Inline expression cannot be empty.',
          lineNumber,
          payloadColumn + nextOpen,
          lineOffset,
          exprEnd - nextOpen + 1
        );
      } else {
        const exprColumn = payloadColumn + nextOpen;
        const exprLength = exprEnd - nextOpen + 1;
        const exprSpan = createSpan(lineNumber, exprColumn, Math.max(exprLength, 1), lineOffset);
        parts.push({ type: 'expr', value: inner, span: exprSpan });
      }

      cursor = exprEnd + 1;
    } else {
      // Handle double brace {{expr}}
      const exprEnd = payload.indexOf('}}', nextOpen + 2);
      if (exprEnd === -1) {
        pushDiag(
          diagnostics,
          'COLLIE005',
          'Inline expression must end with }}.',
          lineNumber,
          payloadColumn + nextOpen,
          lineOffset
        );
        const remainder = payload.slice(nextOpen);
        if (remainder.length) {
          parts.push({ type: 'text', value: remainder });
        }
        break;
      }

      const inner = payload.slice(nextOpen + 2, exprEnd).trim();
      if (!inner) {
        pushDiag(
          diagnostics,
          'COLLIE005',
          'Inline expression cannot be empty.',
          lineNumber,
          payloadColumn + nextOpen,
          lineOffset,
          exprEnd - nextOpen + 2
        );
      } else {
        const exprColumn = payloadColumn + nextOpen;
        const exprLength = exprEnd - nextOpen + 2;
        const exprSpan = createSpan(lineNumber, exprColumn, Math.max(exprLength, 1), lineOffset);
        parts.push({ type: 'expr', value: inner, span: exprSpan });
      }

      cursor = exprEnd + 2;
    }
  }

  return parts;
}

export function parseInlineTextPayload(
  payload: string,
  lineNumber: number,
  column: number,
  lineOffset: number,
  diagnostics: Diagnostic[]
): TextNode {
  const trimmed = payload.trimEnd();
  const span = createSpan(lineNumber, column, Math.max(trimmed.length || 1, 1), lineOffset);
  const parts = parseTextPayload(trimmed, lineNumber, column, lineOffset, diagnostics);
  return { type: 'Text', parts, placement: 'inline', span };
}

export function parseExpressionLine(
  line: string,
  lineNumber: number,
  column: number,
  lineOffset: number,
  diagnostics: Diagnostic[]
): ExpressionNode | null {
  const trimmed = line.trimEnd();
  const span = createSpan(lineNumber, column, Math.max(trimmed.length || 1, 1), lineOffset);
  const closeIndex = trimmed.indexOf('}}');
  if (closeIndex === -1) {
    pushDiag(
      diagnostics,
      'COLLIE005',
      'Expression lines must end with }}.',
      lineNumber,
      column,
      lineOffset
    );
    return null;
  }

  if (trimmed.slice(closeIndex + 2).trim().length) {
    pushDiag(
      diagnostics,
      'COLLIE005',
      'Expression lines cannot contain text after the closing }}.',
      lineNumber,
      column + closeIndex + 2,
      lineOffset
    );
    return null;
  }

  const inner = trimmed.slice(2, closeIndex).trim();
  if (!inner) {
    pushDiag(
      diagnostics,
      'COLLIE005',
      'Expression cannot be empty.',
      lineNumber,
      column,
      lineOffset,
      closeIndex + 2
    );
    return null;
  }

  return { type: 'Expression', value: inner, span };
}

export function parseEqualsExpressionLine(
  line: string,
  lineNumber: number,
  column: number,
  lineOffset: number,
  diagnostics: Diagnostic[]
): ExpressionNode | null {
  const trimmed = line.trimEnd();
  const span = createSpan(lineNumber, column, Math.max(trimmed.length || 1, 1), lineOffset);
  
  if (!trimmed.startsWith('= ')) {
    pushDiag(
      diagnostics,
      'COLLIE005',
      'Expression lines must start with = followed by a space.',
      lineNumber,
      column,
      lineOffset
    );
    return null;
  }

  const inner = trimmed.slice(2).trim();
  if (!inner) {
    pushDiag(
      diagnostics,
      'COLLIE005',
      'Expression cannot be empty.',
      lineNumber,
      column,
      lineOffset,
      trimmed.length
    );
    return null;
  }

  return { type: 'Expression', value: inner, span };
}
