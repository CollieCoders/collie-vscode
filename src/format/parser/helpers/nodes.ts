import type {
  ClassAliasDecl,
  ClassAliasesDecl,
  ElementNode,
  ForLoopNode,
  Node,
  PropsField,
  RootNode,
  TextNode
} from '../ast';
import type { Diagnostic, SourceSpan } from '../diagnostics';
import { createSpan } from '../diagnostics';
import type { ForLoopContext, ParentNode } from '../types';
import { pushDiag } from './errors';
import {
  parseEqualsExpressionLine,
  parseExpressionLine,
  parseInlineTextPayload,
  parseTextPayload
} from './lexer';
import { CLASS_TOKEN, findMatchingParen, looksLikeAttributePayload } from './whitespace';

export function isElementNode(node: ParentNode): node is ElementNode {
  return 'type' in node && node.type === 'Element';
}

export function createForLoopContext(owner: ForLoopNode): ForLoopContext {
  return {
    kind: 'ForLoop',
    owner,
    children: owner.body
  };
}

export function parseTextLine(
  lineContent: string,
  lineNumber: number,
  column: number,
  lineOffset: number,
  diagnostics: Diagnostic[],
  placement: 'inline' | 'block' = 'block'
): TextNode | null {
  const trimmed = lineContent.trimEnd();
  const span = createSpan(lineNumber, column, Math.max(trimmed.length || 1, 1), lineOffset);
  let payload = trimmed.slice(1);
  let payloadColumn = column + 1;

  if (payload.startsWith(' ')) {
    payload = payload.slice(1);
    payloadColumn += 1;
  }

  const parts = parseTextPayload(payload, lineNumber, payloadColumn, lineOffset, diagnostics);

  return { type: 'Text', parts, placement, span };
}

export function parseInlineNode(
  source: string,
  lineNumber: number,
  column: number,
  lineOffset: number,
  diagnostics: Diagnostic[]
): Node | null {
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('|')) {
    return parseTextLine(trimmed, lineNumber, column, lineOffset, diagnostics, 'inline');
  }

  if (trimmed.startsWith('= ')) {
    return parseEqualsExpressionLine(trimmed, lineNumber, column, lineOffset, diagnostics);
  }

  if (trimmed.startsWith('{{')) {
    return parseExpressionLine(trimmed, lineNumber, column, lineOffset, diagnostics);
  }

  if (trimmed.startsWith('@')) {
    pushDiag(
      diagnostics,
      'COLLIE209',
      'Inline conditional bodies may only contain elements, text, or expressions.',
      lineNumber,
      column,
      lineOffset,
      trimmed.length
    );
    return null;
  }

  return parseElement(trimmed, lineNumber, column, lineOffset, diagnostics);
}

export function parsePropsField(
  line: string,
  lineNumber: number,
  column: number,
  lineOffset: number,
  diagnostics: Diagnostic[]
): PropsField | null {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)(\??)\s*:\s*(.+)$/);
  if (!match) {
    pushDiag(
      diagnostics,
      'COLLIE102',
      'Props lines must be in the form `name[:?] Type`.',
      lineNumber,
      column,
      lineOffset,
      Math.max(line.length, 1)
    );
    return null;
  }

  const [, name, optionalFlag, typePart] = match;
  const typeText = typePart.trim();
  if (!typeText) {
    pushDiag(
      diagnostics,
      'COLLIE102',
      'Props lines must provide a type after the colon.',
      lineNumber,
      column,
      lineOffset,
      Math.max(line.length, 1)
    );
    return null;
  }

  const span = createSpan(lineNumber, column, Math.max(line.length, 1), lineOffset);

  return {
    name,
    optional: optionalFlag === '?',
    typeText,
    span
  };
}

export function parseElement(
  line: string,
  lineNumber: number,
  column: number,
  lineOffset: number,
  diagnostics: Diagnostic[]
): ElementNode | null {
  const span = createSpan(lineNumber, column, Math.max(line.length, 1), lineOffset);
  // Split selector-style syntax first (div.welcome.big)
  const selectorMatch = line.match(
    /^([A-Za-z][A-Za-z0-9_$]*)(\.(?:[A-Za-z0-9_-]+|\$[A-Za-z_][A-Za-z0-9_]*))*/
  );
  if (!selectorMatch) {
    pushDiag(
      diagnostics,
      'COLLIE004',
      'Element lines must start with a valid tag or component name.',
      lineNumber,
      column,
      lineOffset,
      Math.max(line.length, 1)
    );
    return null;
  }

  const raw = selectorMatch[0];
  const name = selectorMatch[1];
  const nameSpan = createSpan(lineNumber, column, Math.max(name.length, 1), lineOffset);
  const classes: string[] = [];
  const classSpans: SourceSpan[] = [];

  let inlineSelectorRemainder = raw.slice(name.length);
  let selectorConsumed = name.length;
  while (inlineSelectorRemainder.startsWith('.')) {
    inlineSelectorRemainder = inlineSelectorRemainder.slice(1);
    selectorConsumed += 1;
    const classMatch = inlineSelectorRemainder.match(CLASS_TOKEN);
    if (!classMatch) {
      break;
    }
    const className = classMatch[0];
    classes.push(className);
    classSpans.push(
      createSpan(lineNumber, column + selectorConsumed, Math.max(className.length, 1), lineOffset)
    );
    inlineSelectorRemainder = inlineSelectorRemainder.slice(className.length);
    selectorConsumed += className.length;
  }

  let rest = line.slice(raw.length);
  let inlineText: TextNode | null = null;
  let consumed = raw.length;
  let sawAttributeGroup = false;
  const attributes: string[] = [];

  while (rest.length > 0) {
    // consume whitespace
    const ws = rest.match(/^\s+/);
    if (ws) {
      rest = rest.slice(ws[0].length);
      consumed += ws[0].length;
    }

    if (rest.length === 0) {break;}

    if (rest.startsWith('(')) {
      if (sawAttributeGroup) {
        pushDiag(
          diagnostics,
          'COLLIE004',
          'Element lines may only contain one attribute group.',
          lineNumber,
          column + consumed,
          lineOffset
        );
        return null;
      }
      const closeIndex = findMatchingParen(rest);
      if (closeIndex === -1) {
        pushDiag(
          diagnostics,
          'COLLIE004',
          'Attribute group must be closed with ).',
          lineNumber,
          column + consumed,
          lineOffset
        );
        return null;
      }
      const group = rest.slice(0, closeIndex + 1).trim();
      if (group) {
        attributes.push(group);
      }
      rest = rest.slice(closeIndex + 1);
      consumed += closeIndex + 1;
      sawAttributeGroup = true;
      continue;
    }

    // inline text
    if (rest.startsWith('|')) {
      inlineText = parseTextLine(
        rest,
        lineNumber,
        column + consumed,
        lineOffset,
        diagnostics,
        'inline'
      );
      break;
    }

    // spaced class shorthand: div .foo
    if (rest.startsWith('.')) {
      rest = rest.slice(1);
      consumed++;

      const classMatch = rest.match(CLASS_TOKEN);
      if (!classMatch) {
        pushDiag(
          diagnostics,
          'COLLIE004',
          'Class names must contain only letters, numbers, underscores, or hyphens, or start with $ for aliases.',
          lineNumber,
          column + consumed,
          lineOffset
        );
        return null;
      }

      classes.push(classMatch[0]);
      classSpans.push(
        createSpan(
          lineNumber,
          column + consumed,
          Math.max(classMatch[0].length, 1),
          lineOffset
        )
      );
      rest = rest.slice(classMatch[0].length);
      consumed += classMatch[0].length;
      continue;
    }

    if (looksLikeAttributePayload(rest)) {
      const payload = rest.trimEnd();
      if (payload) {
        attributes.push(payload);
      }
      break;
    }

    inlineText = parseInlineTextPayload(
      rest,
      lineNumber,
      column + consumed,
      lineOffset,
      diagnostics
    );
    break;
  }

  const element: ElementNode = {
    type: 'Element',
    name,
    classes,
    children: inlineText ? [inlineText] : [],
    span,
    nameSpan
  };

  if (classes.length) {
    element.classSpans = classSpans;
  }
  if (attributes.length) {
    element.attributes = attributes;
  }

  return element;
}

export function parseClassAliasLine(
  line: string,
  lineNumber: number,
  column: number,
  lineOffset: number,
  diagnostics: Diagnostic[]
): ClassAliasDecl | null {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  if (!match) {
    pushDiag(
      diagnostics,
      'COLLIE304',
      'Classes lines must be in the form `name = class.tokens`.',
      lineNumber,
      column,
      lineOffset,
      Math.max(line.length, 1)
    );
    return null;
  }

  const [, name, rhsRaw] = match;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    pushDiag(
      diagnostics,
      'COLLIE305',
      `Class alias name '${name}' must be a valid identifier.`,
      lineNumber,
      column,
      lineOffset,
      name.length
    );
    return null;
  }

  const rhs = rhsRaw.trim();
  if (!rhs) {
    pushDiag(
      diagnostics,
      'COLLIE304',
      'Classes lines must provide one or more class tokens after `=`.',
      lineNumber,
      column + line.indexOf('=') + 1,
      lineOffset,
      rhsRaw.length || 1
    );
    return null;
  }

  const rhsNoLeadingDot = rhs.startsWith('.') ? rhs.slice(1) : rhs;
  const classes = rhsNoLeadingDot
    .split('.')
    .map(token => token.trim())
    .filter(Boolean);

  if (!classes.length) {
    pushDiag(
      diagnostics,
      'COLLIE304',
      'Classes lines must provide one or more class tokens after `=`.',
      lineNumber,
      column + line.indexOf('=') + 1,
      lineOffset,
      rhsRaw.length || 1
    );
    return null;
  }

  const span = createSpan(lineNumber, column, Math.max(line.length, 1), lineOffset);
  const nameSpan = createSpan(lineNumber, column, name.length, lineOffset);
  return { name, classes, span, nameSpan };
}

export function validateClassAliasDefinitions(decl: ClassAliasesDecl, diagnostics: Diagnostic[]): void {
  const seen = new Map<string, ClassAliasDecl>();
  for (const alias of decl.aliases) {
    const existing = seen.get(alias.name);
    if (existing) {
      const span = alias.nameSpan ?? alias.span;
      diagnostics.push({
        severity: 'error',
        code: 'COLLIE306',
        message: `Duplicate class alias '${alias.name}'.`,
        span
      });
      continue;
    }
    seen.set(alias.name, alias);
  }
}

export function validateClassAliasUsages(root: RootNode, diagnostics: Diagnostic[]): void {
  const defined = new Set<string>(root.classAliases?.aliases.map(alias => alias.name) ?? []);
  for (const child of root.children) {
    validateNodeClassAliases(child, defined, diagnostics);
  }
}

export function validateNodeClassAliases(
  node: Node,
  defined: Set<string>,
  diagnostics: Diagnostic[]
): void {
  if (node.type === 'Element') {
    const { classes, classSpans } = node;
    for (let index = 0; index < classes.length; index++) {
      const token = classes[index];
      const match = token.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
      if (!match) {
        continue;
      }
      const aliasName = match[1];
      if (!defined.has(aliasName)) {
        diagnostics.push({
          severity: 'error',
          code: 'COLLIE307',
          message: `Undefined class alias '${aliasName}'.`,
          span: classSpans?.[index] ?? node.span
        });
      }
    }
    for (const child of node.children) {
      validateNodeClassAliases(child, defined, diagnostics);
    }
    return;
  }

  if (node.type === 'Conditional') {
    for (const branch of node.branches) {
      for (const child of branch.body) {
        validateNodeClassAliases(child, defined, diagnostics);
      }
    }
  }

  if (node.type === 'ForLoop') {
    for (const child of node.body) {
      validateNodeClassAliases(child, defined, diagnostics);
    }
  }
}
