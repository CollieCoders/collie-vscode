import type {
  ConditionalBranch,
  ConditionalNode,
  ElementNode,
  ExpressionNode,
  Node,
  PropsField,
  RootNode,
  TextNode
} from './ast';
import { type Diagnostic, type DiagnosticCode, type SourceSpan, createSpan } from './diagnostics';

export interface ParseResult {
  root: RootNode;
  diagnostics: Diagnostic[];
}

interface ConditionalBranchContext {
  kind: 'ConditionalBranch';
  owner: ConditionalNode;
  branch: ConditionalBranch;
  children: Node[];
}

type ParentNode = RootNode | ElementNode | ConditionalBranchContext;

interface StackItem {
  node: ParentNode;
  level: number;
}

interface BranchLocation {
  branch: ConditionalBranch;
  span: SourceSpan;
}

interface ConditionalChainState {
  node: ConditionalNode;
  level: number;
  hasElse: boolean;
}

const ELEMENT_NAME = /^[A-Za-z][A-Za-z0-9_-]*/;
const CLASS_NAME = /^[A-Za-z0-9_-]+/;

export function parse(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const root: RootNode = { type: 'Root', children: [] };
  const stack: StackItem[] = [{ node: root, level: -1 }];
  let propsBlockLevel: number | null = null;
  const conditionalChains = new Map<number, ConditionalChainState>();
  const branchLocations: BranchLocation[] = [];

  const normalized = source.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  root.span = createSpan(1, 1, Math.max(normalized.length, 1), 0);

  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNumber = i + 1;
    const lineOffset = offset;
    offset += rawLine.length + 1;

    if (/^\s*$/.test(rawLine)) {
      continue;
    }

    const tabIndex = rawLine.indexOf('\t');
    if (tabIndex !== -1) {
      pushDiag(
        diagnostics,
        'COLLIE001',
        'Tabs are not allowed; use spaces for indentation.',
        lineNumber,
        tabIndex + 1,
        lineOffset
      );
      continue;
    }

    const indentMatch = rawLine.match(/^\s*/) ?? [''];
    const indent = indentMatch[0].length;
    const lineContent = rawLine.slice(indent);
    const trimmed = lineContent.trimEnd();

    if (indent % 2 !== 0) {
      pushDiag(
        diagnostics,
        'COLLIE002',
        'Indentation must be multiples of two spaces.',
        lineNumber,
        indent + 1,
        lineOffset
      );
      continue;
    }

    let level = indent / 2;

    if (propsBlockLevel !== null && level <= propsBlockLevel) {
      propsBlockLevel = null;
    }

    const top = stack[stack.length - 1];
    if (level > top.level + 1) {
      pushDiag(
        diagnostics,
        'COLLIE003',
        'Indentation jumped more than one level.',
        lineNumber,
        indent + 1,
        lineOffset
      );
      level = top.level + 1;
    }

    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    cleanupConditionalChains(conditionalChains, level);
    const isElseIfLine = /^@elseIf\b/.test(trimmed);
    const isElseLine = /^@else\b/.test(trimmed) && !isElseIfLine;
    if (!isElseIfLine && !isElseLine) {
      conditionalChains.delete(level);
    }

    if (trimmed === 'props') {
      if (level !== 0) {
        pushDiag(
          diagnostics,
          'COLLIE102',
          'Props block must be at the top level.',
          lineNumber,
          indent + 1,
          lineOffset,
          trimmed.length
        );
      } else if (root.children.length > 0 || root.props) {
        pushDiag(
          diagnostics,
          'COLLIE101',
          'Props block must appear before any template nodes.',
          lineNumber,
          indent + 1,
          lineOffset,
          trimmed.length
        );
      } else {
        root.props = {
          fields: [],
          span: createSpan(lineNumber, indent + 1, Math.max(trimmed.length, 1), lineOffset)
        };
        propsBlockLevel = level;
      }
      continue;
    }

    if (propsBlockLevel !== null && level > propsBlockLevel) {
      if (level !== propsBlockLevel + 1) {
        pushDiag(
          diagnostics,
          'COLLIE102',
          'Props lines must be indented two spaces under the props header.',
          lineNumber,
          indent + 1,
          lineOffset
        );
        continue;
      }

      const field = parsePropsField(trimmed, lineNumber, indent + 1, lineOffset, diagnostics);
      if (field && root.props) {
        root.props.fields.push(field);
      }
      continue;
    }

    const parent = stack[stack.length - 1].node;

    if (trimmed.startsWith('@if')) {
      const header = parseConditionalHeader(
        'if',
        lineContent,
        lineNumber,
        indent + 1,
        lineOffset,
        diagnostics
      );
      if (!header) {
        continue;
      }
      const chain: ConditionalNode = { type: 'Conditional', branches: [], span: header.span };
      const branch: ConditionalBranch = { test: header.test, body: [], span: header.span };
      chain.branches.push(branch);
      parent.children.push(chain);
      conditionalChains.set(level, { node: chain, level, hasElse: false });
      branchLocations.push({
        branch,
        span: header.span
      });
      if (header.inlineBody) {
        const inlineNode = parseInlineNode(
          header.inlineBody,
          lineNumber,
          header.inlineColumn ?? indent + 1,
          lineOffset,
          diagnostics
        );
        if (inlineNode) {
          branch.body.push(inlineNode);
        }
      } else {
        stack.push({ node: createConditionalBranchContext(chain, branch), level });
      }
      continue;
    }

    if (isElseIfLine) {
      const chain = conditionalChains.get(level);
      if (!chain) {
        pushDiag(
          diagnostics,
          'COLLIE205',
          '@elseIf must follow an @if at the same indentation level.',
          lineNumber,
          indent + 1,
          lineOffset,
          trimmed.length
        );
        continue;
      }
      if (chain.hasElse) {
        pushDiag(
          diagnostics,
          'COLLIE207',
          '@elseIf cannot appear after an @else in the same chain.',
          lineNumber,
          indent + 1,
          lineOffset,
          trimmed.length
        );
        continue;
      }
      const header = parseConditionalHeader(
        'elseIf',
        lineContent,
        lineNumber,
        indent + 1,
        lineOffset,
        diagnostics
      );
      if (!header) {
        continue;
      }
      const branch: ConditionalBranch = { test: header.test, body: [], span: header.span };
      chain.node.branches.push(branch);
      branchLocations.push({
        branch,
        span: header.span
      });
      if (header.inlineBody) {
        const inlineNode = parseInlineNode(
          header.inlineBody,
          lineNumber,
          header.inlineColumn ?? indent + 1,
          lineOffset,
          diagnostics
        );
        if (inlineNode) {
          branch.body.push(inlineNode);
        }
      } else {
        stack.push({ node: createConditionalBranchContext(chain.node, branch), level });
      }
      continue;
    }

    if (isElseLine) {
      const chain = conditionalChains.get(level);
      if (!chain) {
        pushDiag(
          diagnostics,
          'COLLIE206',
          '@else must follow an @if at the same indentation level.',
          lineNumber,
          indent + 1,
          lineOffset,
          trimmed.length
        );
        continue;
      }
      if (chain.hasElse) {
        pushDiag(
          diagnostics,
          'COLLIE203',
          'An @if chain can only have one @else branch.',
          lineNumber,
          indent + 1,
          lineOffset,
          trimmed.length
        );
        continue;
      }
      const header = parseElseHeader(lineContent, lineNumber, indent + 1, lineOffset, diagnostics);
      if (!header) {
        continue;
      }
      const branch: ConditionalBranch = { test: undefined, body: [], span: header.span };
      chain.node.branches.push(branch);
      chain.hasElse = true;
      branchLocations.push({
        branch,
        span: header.span
      });
      if (header.inlineBody) {
        const inlineNode = parseInlineNode(
          header.inlineBody,
          lineNumber,
          header.inlineColumn ?? indent + 1,
          lineOffset,
          diagnostics
        );
        if (inlineNode) {
          branch.body.push(inlineNode);
        }
      } else {
        stack.push({ node: createConditionalBranchContext(chain.node, branch), level });
      }
      continue;
    }

    if (lineContent.startsWith('|')) {
      const textNode = parseTextLine(lineContent, lineNumber, indent + 1, lineOffset, diagnostics);
      if (textNode) {
        parent.children.push(textNode);
      }
      continue;
    }

    if (lineContent.startsWith('{{')) {
      const exprNode = parseExpressionLine(lineContent, lineNumber, indent + 1, lineOffset, diagnostics);
      if (exprNode) {
        parent.children.push(exprNode);
      }
      continue;
    }

    const element = parseElement(trimmed, lineNumber, indent + 1, lineOffset, diagnostics);
    if (!element) {
      continue;
    }

    parent.children.push(element);
    stack.push({ node: element, level });
  }

  for (const info of branchLocations) {
    if (info.branch.body.length === 0) {
      const span = info.span;
      const spanLength = Math.max(span.end.offset - span.start.offset, 1);
      const lineOffset = span.start.offset - (span.start.col - 1);
      pushDiag(
        diagnostics,
        'COLLIE208',
        'Conditional branches must include an inline body or indented block.',
        span.start.line,
        span.start.col,
        lineOffset,
        spanLength
      );
    }
  }

  return { root, diagnostics };
}

function cleanupConditionalChains(state: Map<number, ConditionalChainState>, level: number): void {
  for (const key of Array.from(state.keys())) {
    if (key > level) {
      state.delete(key);
    }
  }
}

interface ConditionalHeaderResult {
  test?: string;
  inlineBody?: string;
  inlineColumn?: number;
  span: SourceSpan;
}

function parseConditionalHeader(
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

function parseElseHeader(
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

function parseInlineNode(
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

function createConditionalBranchContext(
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

function parseTextLine(
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

  const parts: TextNode['parts'] = [];
  let cursor = 0;

  while (cursor < payload.length) {
    const nextOpen = payload.indexOf('{{', cursor);
    const nextClose = payload.indexOf('}}', cursor);

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
        exprEnd - nextOpen
      );
    } else {
      const exprColumn = payloadColumn + nextOpen;
      const exprLength = exprEnd - nextOpen + 2;
      const exprSpan = createSpan(lineNumber, exprColumn, Math.max(exprLength, 1), lineOffset);
      parts.push({ type: 'expr', value: inner, span: exprSpan });
    }

    cursor = exprEnd + 2;
  }

  return { type: 'Text', parts, placement, span };
}

function parseExpressionLine(
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


function parsePropsField(
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

function parseElement(
  line: string,
  lineNumber: number,
  column: number,
  lineOffset: number,
  diagnostics: Diagnostic[]
): ElementNode | null {
  const span = createSpan(lineNumber, column, Math.max(line.length, 1), lineOffset);
  // Split selector-style syntax first (div.welcome.big)
  const selectorMatch = line.match(/^([A-Za-z][A-Za-z0-9_$]*)(\.[A-Za-z0-9_-]+)*/);
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
  const parts = raw.split('.');
  const name = parts[0];
  const classes = parts.slice(1);

  let rest = line.slice(raw.length);
  let inlineText: TextNode | null = null;
  let consumed = raw.length;

  while (rest.length > 0) {
    // consume whitespace
    const ws = rest.match(/^\s+/);
    if (ws) {
      rest = rest.slice(ws[0].length);
      consumed += ws[0].length;
    }

    if (rest.length === 0) break;

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

      const classMatch = rest.match(/^[A-Za-z0-9_-]+/);
      if (!classMatch) {
        pushDiag(
          diagnostics,
          'COLLIE004',
          'Class names must contain only letters, numbers, underscores, or hyphens.',
          lineNumber,
          column + consumed,
          lineOffset
        );
        return null;
      }

      classes.push(classMatch[0]);
      rest = rest.slice(classMatch[0].length);
      consumed += classMatch[0].length;
      continue;
    }

    // anything else is invalid
    pushDiag(
      diagnostics,
      'COLLIE004',
      'Element lines may only contain .class shorthands or inline text after the tag name.',
      lineNumber,
      column + consumed,
      lineOffset
    );
    return null;
  }

  return {
    type: 'Element',
    name,
    classes,
    children: inlineText ? [inlineText] : [],
    span
  };
}

function pushDiag(
  diagnostics: Diagnostic[],
  code: DiagnosticCode,
  message: string,
  line: number,
  column: number,
  lineOffset: number,
  length = 1
): void {
  diagnostics.push({
    severity: 'error',
    code,
    message,
    span: createSpan(line, column, Math.max(length, 1), lineOffset)
  });
}
