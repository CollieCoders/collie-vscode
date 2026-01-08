import type { IrAttribute, IrConditional, IrElement, IrExpression, IrNode, IrText } from '../ir/nodes';

export interface ColliePrintOptions {
  indentSize?: number;
  preferCompactSelectors?: boolean;
  spaceAroundPipe?: boolean;
}

const DEFAULT_OPTIONS: Required<ColliePrintOptions> = {
  indentSize: 2,
  preferCompactSelectors: true,
  spaceAroundPipe: true
};

interface PrinterContext {
  options: Required<ColliePrintOptions>;
  indentUnit: string;
}

export function printCollieDocument(nodes: readonly IrNode[], options: ColliePrintOptions = {}): string {
  const resolved: Required<ColliePrintOptions> = {
    indentSize: options.indentSize ?? DEFAULT_OPTIONS.indentSize,
    preferCompactSelectors: options.preferCompactSelectors ?? DEFAULT_OPTIONS.preferCompactSelectors,
    spaceAroundPipe: options.spaceAroundPipe ?? DEFAULT_OPTIONS.spaceAroundPipe
  };

  const ctx: PrinterContext = {
    options: resolved,
    indentUnit: ' '.repeat(Math.max(0, resolved.indentSize))
  };

  const lines: string[] = [];
  for (const node of nodes) {
    printNode(node, 0, ctx, lines);
  }

  if (lines.length === 0) {
    return '';
  }

  return `${lines.join('\n')  }\n`;
}

function printNode(node: IrNode, level: number, ctx: PrinterContext, out: string[]) {
  switch (node.kind) {
    case 'element':
      printElement(node, level, ctx, out);
      break;
    case 'text':
      printText(node, level, ctx, out);
      break;
    case 'expression':
      printExpression(node, level, ctx, out);
      break;
    case 'fragment':
      for (const child of node.children) {
        printNode(child, level, ctx, out);
      }
      break;
    case 'conditional':
      printConditional(node, level, ctx, out);
      break;
    default: {
      const exhaustive: never = node;
      throw new Error(`Unsupported IR node: ${(exhaustive as IrNode).kind}`);
    }
  }
}

function printElement(node: IrElement, level: number, ctx: PrinterContext, out: string[]) {
  const indent = createIndent(level, ctx);
  let line = indent + formatSelector(node, ctx) + formatAttributes(node.attributes, ctx);

  const inlineChild = getInlineChild(node.children, ctx);
  if (inlineChild) {
    line += ` ${inlineChild}`;
    out.push(line);
    return;
  }

  out.push(line);
  for (const child of node.children) {
    printNode(child, level + 1, ctx, out);
  }
}

function formatSelector(node: IrElement, ctx: PrinterContext) {
  if (!node.classes.length) {
    return node.tagName;
  }

  if (ctx.options.preferCompactSelectors) {
    return node.tagName + node.classes.map(cls => `.${cls}`).join('');
  }

  return node.tagName + node.classes.map(cls => ` .${cls}`).join('');
}

function formatAttributes(attributes: readonly (IrAttribute | IrExpression)[], ctx: PrinterContext) {
  if (!attributes.length) {
    return '';
  }

  const parts: string[] = [];
  for (const attr of attributes) {
    if (attr.kind === 'attribute') {
      const value = attr.value !== undefined ? `=${normalizeAttributeValue(attr.value)}` : '';
      parts.push(`${attr.name}${value}`);
      continue;
    }
    parts.push(formatExpressionPayload(attr.expressionText));
  }

  return `(${parts.join(' ')})`;
}

function normalizeAttributeValue(value: string): string {
  // If the value contains curly braces (expression), normalize its whitespace
  if (value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1);
    const normalized = normalizeExpressionWhitespace(inner);
    return `{${normalized}}`;
  }
  // For string literals and other values, keep them as-is
  return value;
}

function getInlineChild(children: readonly IrNode[], ctx: PrinterContext): string | undefined {
  if (children.length !== 1) {
    return undefined;
  }

  const [child] = children;
  if (child.kind === 'text') {
    return formatInlineText(child, ctx);
  }

  if (child.kind === 'expression') {
    return formatExpressionPayload(child.expressionText);
  }

  return undefined;
}

function printText(node: IrText, level: number, ctx: PrinterContext, out: string[]) {
  const indent = createIndent(level, ctx);
  const pipe = ctx.options.spaceAroundPipe ? '| ' : '|';
  out.push(`${indent}${pipe}${node.value}`);
}

function printExpression(node: IrExpression, level: number, ctx: PrinterContext, out: string[]) {
  const indent = createIndent(level, ctx);
  out.push(`${indent}${formatExpressionPayload(node.expressionText)}`);
}

function formatExpressionPayload(expression: string) {
  // Collapse newlines and excessive whitespace to ensure attribute groups stay on one line
  // Preserve whitespace in string literals by doing a simple line break replacement
  const normalized = normalizeExpressionWhitespace(expression);
  return `{{ ${normalized} }}`;
}

function normalizeExpressionWhitespace(text: string): string {
  // Replace newlines with spaces, but be careful about string literals
  // This is a simple heuristic: collapse sequences of whitespace to single spaces
  // More sophisticated string-aware parsing would be needed for perfect handling,
  // but this should work for most generated code
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join(' ');
}

function createIndent(level: number, ctx: PrinterContext) {
  if (level <= 0) {
    return '';
  }

  return ctx.indentUnit.repeat(level);
}

function formatInlineText(node: IrText, ctx: PrinterContext): string {
  if (!node.value) {
    return ctx.options.spaceAroundPipe ? '| ' : '|';
  }
  return ctx.options.spaceAroundPipe ? `| ${node.value}` : `|${node.value}`;
}

function printConditional(node: IrConditional, level: number, ctx: PrinterContext, out: string[]) {
  if (node.branches.length === 0) {
    return;
  }

  for (let i = 0; i < node.branches.length; i += 1) {
    const branch = node.branches[i];
    const indent = createIndent(level, ctx);
    const directive = resolveConditionalDirective(i, branch.test);
    const line = branch.test ? `${indent}${directive} (${branch.test})` : `${indent}${directive}`;
    out.push(line);
    for (const child of branch.children) {
      printNode(child, level + 1, ctx, out);
    }
  }
}

function resolveConditionalDirective(index: number, test: string | undefined): string {
  if (index === 0) {
    return '@if';
  }
  return test ? '@elseIf' : '@else';
}
