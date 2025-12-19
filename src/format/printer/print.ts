import type {
  ClassAliasesDecl,
  ConditionalNode,
  ElementNode,
  ExpressionNode,
  ForLoopNode,
  Node,
  PropsDecl,
  RootNode,
  TextNode
} from '../parser';
import { buildTextPayload, formatInlinePipe } from './text';

export interface PrintOptions {
  indentSize?: number;
  preferCompactSelectors?: boolean;
  spaceAroundPipe?: boolean;
  normalizePropsSpacing?: boolean;
}

const DEFAULT_OPTIONS: Required<PrintOptions> = {
  indentSize: 2,
  preferCompactSelectors: true,
  spaceAroundPipe: true,
  normalizePropsSpacing: true
};

interface PrinterContext {
  options: Required<PrintOptions>;
  indentUnit: string;
}

export function print(root: RootNode, options: PrintOptions = {}): string {
  const resolved: Required<PrintOptions> = {
    indentSize: options.indentSize ?? DEFAULT_OPTIONS.indentSize,
    preferCompactSelectors: options.preferCompactSelectors ?? DEFAULT_OPTIONS.preferCompactSelectors,
    spaceAroundPipe: options.spaceAroundPipe ?? DEFAULT_OPTIONS.spaceAroundPipe,
    normalizePropsSpacing: options.normalizePropsSpacing ?? DEFAULT_OPTIONS.normalizePropsSpacing
  };

  const ctx: PrinterContext = {
    options: resolved,
    indentUnit: ' '.repeat(Math.max(0, resolved.indentSize))
  };

  const lines: string[] = [];

  if (root.props) {
    lines.push(...printProps(root.props, ctx));
    if (root.classAliases || root.children.length) {
      lines.push('');
    }
  }

  if (root.classAliases) {
    lines.push(...printClassAliases(root.classAliases, ctx));
    if (root.children.length) {
      lines.push('');
    }
  }

  for (const child of root.children) {
    printNode(child, 0, ctx, lines);
  }

  return lines.join('\n') + '\n';
}

function printProps(props: PropsDecl, ctx: PrinterContext): string[] {
  const lines = ['props'];
  for (const field of props.fields) {
    const indent = createIndent(ctx, 1);
    const optionalFlag = field.optional ? '?' : '';
    const separator = ctx.options.normalizePropsSpacing ? ': ' : ':';
    lines.push(`${indent}${field.name}${optionalFlag}${separator}${field.typeText}`);
  }
  return lines;
}

function printClassAliases(aliases: ClassAliasesDecl, ctx: PrinterContext): string[] {
  const lines = ['classes'];
  for (const alias of aliases.aliases) {
    const indent = createIndent(ctx, 1);
    const rhs = alias.classes.join('.');
    lines.push(`${indent}${alias.name} = ${rhs}`);
  }
  return lines;
}

function printNode(node: Node, level: number, ctx: PrinterContext, out: string[]) {
  switch (node.type) {
    case 'Element':
      printElement(node, level, ctx, out);
      break;
    case 'Text':
      printText(node, level, ctx, out);
      break;
    case 'Expression':
      printExpression(node, level, ctx, out);
      break;
    case 'Conditional':
      printConditional(node, level, ctx, out);
      break;
    case 'ForLoop':
      printForLoop(node, level, ctx, out);
      break;
    default: {
      const exhaustive: never = node;
      throw new Error(`Unsupported node type ${(exhaustive as Node).type}`);
    }
  }
}

function printElement(node: ElementNode, level: number, ctx: PrinterContext, out: string[]) {
  const indent = createIndent(ctx, level);
  let line = indent + formatElementSelector(node, ctx);
  const inlineText = getInlineTextChild(node);

  if (inlineText) {
    line += ' ' + formatInlinePipe(inlineText, ctx.options);
    out.push(line);
    return;
  }

  out.push(line);
  for (const child of node.children) {
    printNode(child, level + 1, ctx, out);
  }
}

function formatElementSelector(node: ElementNode, ctx: PrinterContext): string {
  if (!node.classes.length) {
    return node.name;
  }

  if (ctx.options.preferCompactSelectors) {
    return node.name + node.classes.map(cls => `.${cls}`).join('');
  }

  return node.name + node.classes.map(cls => ` .${cls}`).join('');
}

function getInlineTextChild(node: ElementNode): TextNode | null {
  if (node.children.length !== 1) {
    return null;
  }

  const child = node.children[0];
  return child.type === 'Text' && child.placement === 'inline' ? child : null;
}

function printText(node: TextNode, level: number, ctx: PrinterContext, out: string[]) {
  const indent = createIndent(ctx, level);
  const payload = buildTextPayload(node);
  let line = indent + '|';
  if (payload) {
    line += ctx.options.spaceAroundPipe ? ` ${payload}` : payload;
  } else if (ctx.options.spaceAroundPipe) {
    line += ' ';
  }
  out.push(line);
}

function printExpression(node: ExpressionNode, level: number, ctx: PrinterContext, out: string[]) {
  const indent = createIndent(ctx, level);
  // Prefer the new = expression syntax
  out.push(`${indent}= ${node.value}`);
}

function printConditional(node: ConditionalNode, level: number, ctx: PrinterContext, out: string[]) {
  node.branches.forEach((branch, index) => {
    const indent = createIndent(ctx, level);
    const keyword = index === 0 ? '@if' : branch.test ? '@elseIf' : '@else';
    let line = indent + keyword;

    if (branch.test) {
      line += ` (${branch.test})`;
    }

    const inlineBody = formatInlineBranchBody(branch.body, ctx);
    if (inlineBody) {
      line += ' ' + inlineBody;
      out.push(line);
      return;
    }

    out.push(line);
    for (const child of branch.body) {
      printNode(child, level + 1, ctx, out);
    }
  });
}

function printForLoop(node: ForLoopNode, level: number, ctx: PrinterContext, out: string[]) {
  const indent = createIndent(ctx, level);
  const line = `${indent}@for ${node.variable} in ${node.iterable}`;
  out.push(line);
  for (const child of node.body) {
    printNode(child, level + 1, ctx, out);
  }
}

function formatInlineBranchBody(nodes: Node[], ctx: PrinterContext): string | null {
  if (nodes.length !== 1) {
    return null;
  }

  const [only] = nodes;
  if (only.type === 'Text') {
    if (only.placement !== 'inline') {
      return null;
    }
    return formatInlinePipe(only, ctx.options);
  }
  if (only.type === 'Element') {
    return formatInlineElement(only, ctx);
  }
  if (only.type === 'Expression') {
    return `{{ ${only.value} }}`;
  }
  return null;
}

function formatInlineElement(node: ElementNode, ctx: PrinterContext): string | null {
  const selector = formatElementSelector(node, ctx);
  if (node.children.length === 0) {
    return selector;
  }
  const inlineText = getInlineTextChild(node);
  if (inlineText && node.children.length === 1) {
    return `${selector} ${formatInlinePipe(inlineText, ctx.options)}`;
  }
  return null;
}

function createIndent(ctx: PrinterContext, level: number): string {
  if (level <= 0) {
    return '';
  }
  const { indentUnit } = ctx;
  if (!indentUnit.length) {
    return ''.padEnd(level * ctx.options.indentSize, ' ');
  }
  return indentUnit.repeat(level);
}
