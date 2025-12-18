import type { IrConditional, IrElement, IrExpression, IrNode, IrProp, IrText } from '../ir/nodes';

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

  return lines.join('\n') + '\n';
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
      throw new Error('Conditional IR nodes are not supported in the Collie printer.');
    default: {
      const exhaustive: never = node;
      throw new Error(`Unsupported IR node: ${(exhaustive as IrNode).kind}`);
    }
  }
}

function printElement(node: IrElement, level: number, ctx: PrinterContext, out: string[]) {
  const indent = createIndent(level, ctx);
  let line = indent + formatSelector(node, ctx) + formatProps(node.props, ctx);

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

function formatProps(props: readonly (IrProp | IrExpression)[], ctx: PrinterContext) {
  if (!props.length) {
    return '';
  }

  const parts: string[] = [];
  for (const prop of props) {
    if (prop.kind === 'prop') {
      const value = prop.value !== undefined ? `=${prop.value}` : '';
      parts.push(`${prop.name}${value}`);
      continue;
    }
    parts.push(formatExpressionPayload(prop.expressionText));
  }

  return ' ' + parts.join(' ');
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
  return `{{ ${expression} }}`;
}

function createIndent(level: number, ctx: PrinterContext) {
  if (level <= 0) {
    return '';
  }

  return ctx.indentUnit.repeat(level);
}
