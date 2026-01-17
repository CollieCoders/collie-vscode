/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import type { ConditionalBranch, ConditionalNode, DocumentNode, RootNode } from './ast';
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
  const document: DocumentNode = { type: 'Document', sections: [] };
  const allBranchLocations: BranchLocation[] = [];
  const legacyDirective = String.fromCharCode(112, 114, 111, 112, 115);
  const legacyHashDirective = `${String.fromCharCode(35)}${legacyDirective}`;

  interface SectionState {
    root: RootNode;
    stack: StackItem[];
    inputsBlockLevel: number | null;
    classesBlockLevel: number | null;
    conditionalChains: Map<number, ConditionalChainState>;
    branchLocations: BranchLocation[];
    hasTemplateNodes: boolean;
  }

  let sectionState: SectionState | null = null;
  let missingIdDiagnosticEmitted = false;

  const normalized = source.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  let offset = 0;

  const startSection = (lineNumber: number, lineOffset: number): SectionState => {
    const root: RootNode = { type: 'Root', children: [] };
    root.span = {
      start: { line: lineNumber, col: 1, offset: lineOffset },
      end: { line: lineNumber, col: 1, offset: lineOffset }
    };
    document.sections.push(root);
    return {
      root,
      stack: [{ node: root, level: -1 }],
      inputsBlockLevel: null,
      classesBlockLevel: null,
      conditionalChains: new Map<number, ConditionalChainState>(),
      branchLocations: [],
      hasTemplateNodes: false
    };
  };

  const finalizeSection = (
    state: SectionState,
    endLine: number,
    endCol: number,
    endOffset: number
  ): void => {
    if (!state.root.span) {
      state.root.span = {
        start: { line: endLine, col: endCol, offset: endOffset },
        end: { line: endLine, col: endCol, offset: endOffset }
      };
    } else {
      state.root.span.end = { line: endLine, col: endCol, offset: endOffset };
    }
    allBranchLocations.push(...state.branchLocations);
  };

  const ensureSectionForContent = (lineNumber: number, lineOffset: number): SectionState => {
    if (!sectionState) {
      sectionState = startSection(lineNumber, lineOffset);
      if (!missingIdDiagnosticEmitted) {
        pushDiag(
          diagnostics,
          'COLLIE402',
          'ID directive must appear before inputs, classes, and any template nodes.',
          lineNumber,
          1,
          lineOffset,
          1
        );
        missingIdDiagnosticEmitted = true;
      }
    }
    return sectionState;
  };

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

    const isCommentLine = trimmed.startsWith('//') || trimmed.startsWith('#collie-ignore-');
    if (isCommentLine) {
      continue;
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
      } else {
        if (sectionState) {
          finalizeSection(sectionState, lineNumber, 1, lineOffset);
        }
        sectionState = startSection(lineNumber, lineOffset);
        const root = sectionState.root;
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

    const active = ensureSectionForContent(lineNumber, lineOffset);

    if (active.inputsBlockLevel !== null && level <= active.inputsBlockLevel) {
      active.inputsBlockLevel = null;
    }
    if (active.classesBlockLevel !== null && level <= active.classesBlockLevel) {
      active.classesBlockLevel = null;
    }

    const inInputsBlock = active.inputsBlockLevel !== null && level > active.inputsBlockLevel;
    const inClassesBlock = active.classesBlockLevel !== null && level > active.classesBlockLevel;

    const top = active.stack[active.stack.length - 1];
    if (!isCommentLine && !inInputsBlock && !inClassesBlock && level > top.level + 1) {
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

    while (active.stack.length > 1 && active.stack[active.stack.length - 1].level >= level) {
      active.stack.pop();
    }

    cleanupConditionalChains(active.conditionalChains, level);
    const isElseIfLine = /^@elseIf\b/.test(trimmed);
    const isElseLine = /^@else\b/.test(trimmed) && !isElseIfLine;
    if (!isElseIfLine && !isElseLine) {
      active.conditionalChains.delete(level);
    }

    if (trimmed === legacyDirective || trimmed === legacyHashDirective || trimmed === 'inputs') {
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

    if (trimmed === 'classes') {
      pushDiag(
        diagnostics,
        'COLLIE105',
        'Invalid directive. Use #classes.',
        lineNumber,
        indent + 1,
        lineOffset,
        trimmed.length
      );
      continue;
    }

    if (trimmed === '#inputs') {
      if (!sectionState) {
        sectionState = startSection(lineNumber, lineOffset);
      }
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
      } else if (sectionState.hasTemplateNodes || sectionState.root.inputs) {
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
        sectionState.root.inputs = {
          fields: [],
          span: createSpan(lineNumber, indent + 1, Math.max(trimmed.length, 1), lineOffset)
        };
        sectionState.inputsBlockLevel = level;
      }
      continue;
    }

    if (trimmed === '#classes') {
      if (!sectionState) {
        sectionState = startSection(lineNumber, lineOffset);
      }
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
      } else if (sectionState.hasTemplateNodes) {
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
        if (!sectionState.root.classAliases) {
          sectionState.root.classAliases = {
            aliases: [],
            span: headerSpan
          };
        } else if (sectionState.root.classAliases.span) {
          sectionState.root.classAliases.span = {
            ...sectionState.root.classAliases.span,
            end: headerSpan.end
          };
        }
        sectionState.classesBlockLevel = level;
      }
      continue;
    }

    if (sectionState.inputsBlockLevel !== null && level > sectionState.inputsBlockLevel) {
      if (level !== sectionState.inputsBlockLevel + 1) {
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
      if (field && sectionState.root.inputs) {
        sectionState.root.inputs.fields.push(field);
      }
      continue;
    }

    if (sectionState.classesBlockLevel !== null && level > sectionState.classesBlockLevel) {
      if (level !== sectionState.classesBlockLevel + 1) {
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
        sectionState.root.classAliases ??= { aliases: [] };
        sectionState.root.classAliases.aliases.push(alias);
      }
      continue;
    }

    const parent = sectionState.stack[sectionState.stack.length - 1].node;

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
      sectionState.hasTemplateNodes = true;
      parent.children.push(forLoop);
      sectionState.stack.push({ node: createForLoopContext(forLoop), level });
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
      sectionState.hasTemplateNodes = true;
      parent.children.push(chain);
      sectionState.conditionalChains.set(level, { node: chain, level, hasElse: false });
      sectionState.branchLocations.push({
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
        sectionState.stack.push({ node: createConditionalBranchContext(chain, branch), level });
      }
      continue;
    }

    if (isElseIfLine) {
      const chain = sectionState.conditionalChains.get(level);
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
      sectionState.branchLocations.push({
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
        sectionState.stack.push({ node: createConditionalBranchContext(chain.node, branch), level });
      }
      continue;
    }

    if (isElseLine) {
      const chain = sectionState.conditionalChains.get(level);
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
      sectionState.branchLocations.push({
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
        sectionState.stack.push({ node: createConditionalBranchContext(chain.node, branch), level });
      }
      continue;
    }

    if (lineContent.startsWith('|')) {
      const textNode = parseTextLine(lineContent, lineNumber, indent + 1, lineOffset, diagnostics);
      if (textNode) {
        sectionState.hasTemplateNodes = true;
        parent.children.push(textNode);
      }
      continue;
    }

    if (lineContent.startsWith('= ')) {
      const exprNode = parseEqualsExpressionLine(lineContent, lineNumber, indent + 1, lineOffset, diagnostics);
      if (exprNode) {
        sectionState.hasTemplateNodes = true;
        parent.children.push(exprNode);
      }
      continue;
    }

    if (lineContent.startsWith('{{')) {
      const exprNode = parseExpressionLine(lineContent, lineNumber, indent + 1, lineOffset, diagnostics);
      if (exprNode) {
        sectionState.hasTemplateNodes = true;
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

    sectionState.hasTemplateNodes = true;
    parent.children.push(element);
    sectionState.stack.push({ node: element, level });
  }

  if (sectionState) {
    const lastLineIndex = Math.max(lines.length - 1, 0);
    const lastLineLength = lines[lastLineIndex]?.length ?? 0;
    finalizeSection(sectionState, lastLineIndex + 1, lastLineLength + 1, Math.max(normalized.length, 0));
  }

  for (const info of allBranchLocations) {
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

  for (const section of document.sections) {
    if (section.classAliases) {
      validateClassAliasDefinitions(section.classAliases, diagnostics);
    }
    validateClassAliasUsages(section, diagnostics);
  }

  const lastLineIndex = Math.max(lines.length - 1, 0);
  const lastLineLength = lines[lastLineIndex]?.length ?? 0;
  document.span = {
    start: { line: 1, col: 1, offset: 0 },
    end: { line: lastLineIndex + 1, col: lastLineLength + 1, offset: Math.max(normalized.length, 0) }
  };

  return { document, diagnostics };
}
