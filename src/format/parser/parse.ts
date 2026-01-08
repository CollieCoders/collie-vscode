/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import type { ConditionalBranch, ConditionalNode, RootNode } from './ast';
import { type Diagnostic, createSpan } from './diagnostics';
import {
  cleanupConditionalChains,
  createConditionalBranchContext,
  parseConditionalHeader,
  parseElseHeader,
  parseForLoop
} from './helpers/directives';
import { pushDiag } from './helpers/errors';
import { parseEqualsExpressionLine, parseExpressionLine } from './helpers/lexer';
import {
  createForLoopContext,
  isElementNode,
  parseClassAliasLine,
  parseElement,
  parseInputsField,
  parseInlineNode,
  parseTextLine,
  validateClassAliasDefinitions,
  validateClassAliasUsages
} from './helpers/nodes';
import { looksLikeAttributePayload } from './helpers/whitespace';
import type { BranchLocation, ConditionalChainState, ParseResult, StackItem } from './types';

export function parse(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const root: RootNode = { type: 'Root', children: [] };
  const stack: StackItem[] = [{ node: root, level: -1 }];
  let inputsBlockLevel: number | null = null;
  let classesBlockLevel: number | null = null;
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

    if (inputsBlockLevel !== null && level <= inputsBlockLevel) {
      inputsBlockLevel = null;
    }
    if (classesBlockLevel !== null && level <= classesBlockLevel) {
      classesBlockLevel = null;
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

    // Parse ID directive (case-insensitive, supports multiple forms)
    const idMatch = /^(?:#|)id(?:\s+|:\s*|=\s*)(.+)$/i.exec(trimmed);
    if (idMatch) {
      const rawValue = idMatch[1].trim();
      if (level !== 0) {
        pushDiag(
          diagnostics,
          'COLLIE401',
          'ID directive must be at the top level.',
          lineNumber,
          indent + 1,
          lineOffset,
          trimmed.length
        );
      } else if (root.children.length > 0 || root.inputs || root.classAliases) {
        pushDiag(
          diagnostics,
          'COLLIE402',
          'ID directive must appear before inputs, classes, and any template nodes.',
          lineNumber,
          indent + 1,
          lineOffset,
          trimmed.length
        );
      } else {
        root.rawId = rawValue;
        // Normalize: strip trailing -collie
        let normalized = rawValue;
        if (normalized.endsWith('-collie')) {
          normalized = normalized.slice(0, -7).trim();
        }
        root.id = normalized || rawValue;
        root.idSpan = createSpan(lineNumber, indent + 1, trimmed.length, lineOffset);
      }
      continue;
    }

    if (trimmed === 'props' || trimmed === '#props' || trimmed === 'inputs') {
      pushDiag(
        diagnostics,
        'COLLIE105',
        'Invalid directive. Use #inputs.',
        lineNumber,
        indent + 1,
        lineOffset,
        trimmed.length
      );
      continue;
    }

    if (trimmed === '#inputs') {
      if (level !== 0) {
        pushDiag(
          diagnostics,
          'COLLIE102',
          'Inputs block must be at the top level.',
          lineNumber,
          indent + 1,
          lineOffset,
          trimmed.length
        );
      } else if (root.children.length > 0 || root.inputs) {
        pushDiag(
          diagnostics,
          'COLLIE101',
          'Inputs block must appear before any template nodes.',
          lineNumber,
          indent + 1,
          lineOffset,
          trimmed.length
        );
      } else {
        root.inputs = {
          fields: [],
          span: createSpan(lineNumber, indent + 1, Math.max(trimmed.length, 1), lineOffset)
        };
        inputsBlockLevel = level;
      }
      continue;
    }

    if (trimmed === 'classes') {
      if (level !== 0) {
        pushDiag(
          diagnostics,
          'COLLIE301',
          'Classes block must be at the top level.',
          lineNumber,
          indent + 1,
          lineOffset,
          trimmed.length
        );
      } else if (root.children.length > 0) {
        pushDiag(
          diagnostics,
          'COLLIE302',
          'Classes block must appear before any template nodes.',
          lineNumber,
          indent + 1,
          lineOffset,
          trimmed.length
        );
      } else {
        const headerSpan = createSpan(lineNumber, indent + 1, Math.max(trimmed.length, 1), lineOffset);
        if (!root.classAliases) {
          root.classAliases = {
            aliases: [],
            span: headerSpan
          };
        } else if (root.classAliases.span) {
          root.classAliases.span = {
            ...root.classAliases.span,
            end: headerSpan.end
          };
        }
        classesBlockLevel = level;
      }
      continue;
    }

    if (inputsBlockLevel !== null && level > inputsBlockLevel) {
      if (level !== inputsBlockLevel + 1) {
        pushDiag(
          diagnostics,
          'COLLIE102',
          'Inputs lines must be indented two spaces under the inputs header.',
          lineNumber,
          indent + 1,
          lineOffset
        );
        continue;
      }

      const field = parseInputsField(trimmed, lineNumber, indent + 1, lineOffset, diagnostics);
      if (field && root.inputs) {
        root.inputs.fields.push(field);
      }
      continue;
    }

    if (classesBlockLevel !== null && level > classesBlockLevel) {
      if (level !== classesBlockLevel + 1) {
        pushDiag(
          diagnostics,
          'COLLIE303',
          'Classes lines must be indented two spaces under the classes header.',
          lineNumber,
          indent + 1,
          lineOffset
        );
        continue;
      }

      const alias = parseClassAliasLine(
        trimmed,
        lineNumber,
        indent + 1,
        lineOffset,
        diagnostics
      );
      if (alias) {
        root.classAliases ??= { aliases: [] };
        root.classAliases.aliases.push(alias);
      }
      continue;
    }

    const parent = stack[stack.length - 1].node;

    if (trimmed.startsWith('@for')) {
      const forLoop = parseForLoop(
        trimmed,
        lineNumber,
        indent + 1,
        lineOffset,
        diagnostics
      );
      if (!forLoop) {
        continue;
      }
      parent.children.push(forLoop);
      stack.push({ node: createForLoopContext(forLoop), level });
      continue;
    }

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

    if (lineContent.startsWith('= ')) {
      const exprNode = parseEqualsExpressionLine(lineContent, lineNumber, indent + 1, lineOffset, diagnostics);
      if (exprNode) {
        parent.children.push(exprNode);
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

    if (isElementNode(parent) && looksLikeAttributePayload(trimmed)) {
      parent.attributeLines ??= [];
      parent.attributeLines.push(trimmed);
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

  if (root.classAliases) {
    validateClassAliasDefinitions(root.classAliases, diagnostics);
  }
  validateClassAliasUsages(root, diagnostics);

  return { root, diagnostics };
}
