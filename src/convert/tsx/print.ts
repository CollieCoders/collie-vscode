import type { IrConditional, IrConditionalBranch, IrElement, IrExpression, IrFragment, IrNode, IrText } from '../ir/nodes';

type JsxTarget = 'JSX' | 'TSX';

export interface JsxPrintOptions {
  readonly target?: JsxTarget;
  readonly indentSize?: number;
}

interface JsxPrinterContext {
  readonly indentUnit: string;
  readonly target: JsxTarget;
}

const DEFAULT_INDENT = 2;

export function printJsxNodes(nodes: readonly IrNode[], options: JsxPrintOptions = {}): string {
  const indentSize = options.indentSize ?? DEFAULT_INDENT;
  const ctx: JsxPrinterContext = {
    indentUnit: ' '.repeat(Math.max(0, indentSize)),
    target: options.target ?? 'JSX'
  };

  const output: string[] = [];
  const needsFragment = shouldWrapWithFragment(nodes);
  if (needsFragment) {
    output.push('<>');
    printNodeList(nodes, 1, ctx, output);
    output.push('</>');
  } else {
    printNodeList(nodes, 0, ctx, output);
  }

  return output.join('\n') + '\n';
}

function shouldWrapWithFragment(nodes: readonly IrNode[]): boolean {
  if (nodes.length <= 1) {
    return false;
  }
  return true;
}

function printNodeList(nodes: readonly IrNode[], level: number, ctx: JsxPrinterContext, out: string[]) {
  for (const node of nodes) {
    printNode(node, level, ctx, out);
  }
}

function printNode(node: IrNode, level: number, ctx: JsxPrinterContext, out: string[]) {
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
      printFragment(node, level, ctx, out);
      break;
    case 'conditional':
      printConditional(node, level, ctx, out);
      break;
    default: {
      const exhaustive: never = node;
      throw new Error(`Unsupported IR node for JSX printing: ${(exhaustive as IrNode).kind}`);
    }
  }
}

function printElement(node: IrElement, level: number, ctx: JsxPrinterContext, out: string[]) {
  const indent = createIndent(level, ctx);
  const propsSegment = formatElementProps(node);
  const opening = `<${node.tagName}${propsSegment}`;
  if (node.children.length === 0) {
    out.push(`${indent}${opening} />`);
    return;
  }

  out.push(`${indent}${opening}>`);
  printNodeList(node.children, level + 1, ctx, out);
  out.push(`${indent}</${node.tagName}>`);
}

function formatElementProps(node: IrElement): string {
  const attributes: string[] = [];
  if (node.classes.length > 0) {
    attributes.push(`className=${JSON.stringify(node.classes.join(' '))}`);
  }

  for (const prop of node.props) {
    if (prop.kind === 'prop') {
      if (prop.value === undefined) {
        attributes.push(prop.name);
      } else {
        attributes.push(`${prop.name}=${prop.value}`);
      }
      continue;
    }

    attributes.push(`{${prop.expressionText}}`);
  }

  if (!attributes.length) {
    return '';
  }

  return ' ' + attributes.join(' ');
}

function printFragment(node: IrFragment, level: number, ctx: JsxPrinterContext, out: string[]) {
  const indent = createIndent(level, ctx);
  if (node.children.length === 0) {
    out.push(`${indent}<></>`);
    return;
  }

  out.push(`${indent}<>`);
  printNodeList(node.children, level + 1, ctx, out);
  out.push(`${indent}</>`);
}

function printText(node: IrText, level: number, ctx: JsxPrinterContext, out: string[]) {
  const indent = createIndent(level, ctx);
  const safeValue = formatJsxText(node.value);
  out.push(`${indent}${safeValue}`);
}

function formatJsxText(value: string): string {
  if (!value) {
    return '';
  }

  if (/^[^<>&{}\r\n]+$/.test(value)) {
    return value;
  }

  return `{${JSON.stringify(value)}}`;
}

function printExpression(node: IrExpression, level: number, ctx: JsxPrinterContext, out: string[]) {
  const indent = createIndent(level, ctx);
  out.push(`${indent}{${node.expressionText}}`);
}

function printConditional(node: IrConditional, level: number, ctx: JsxPrinterContext, out: string[]) {
  if (node.branches.length === 0) {
    const indent = createIndent(level, ctx);
    out.push(`${indent}{null}`);
    return;
  }

  if (node.branches.length === 1 && node.branches[0].test) {
    printSingleBranchConditional(node.branches[0], level, ctx, out);
    return;
  }

  printTernaryConditional(node.branches, level, ctx, out);
}

function printSingleBranchConditional(
  branch: IrConditionalBranch,
  level: number,
  ctx: JsxPrinterContext,
  out: string[]
) {
  const indent = createIndent(level, ctx);
  out.push(`${indent}{${branch.test} && (`); // closing line added below
  printConditionalBranchBody(branch, level + 1, ctx, out);
  out.push(`${indent})}`);
}

function printTernaryConditional(
  branches: readonly IrConditionalBranch[],
  level: number,
  ctx: JsxPrinterContext,
  out: string[]
) {
  const indent = createIndent(level, ctx);
  out.push(`${indent}{`);
  let hasCondition = false;

  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    const branchIndent = createIndent(level + 1, ctx);
    if (branch.test) {
      if (!hasCondition) {
        out.push(`${branchIndent}${branch.test} ? (`);
        hasCondition = true;
      } else {
        out.push(`${branchIndent}: ${branch.test} ? (`);
      }
      printConditionalBranchBody(branch, level + 2, ctx, out);
      out.push(`${branchIndent})`);
      continue;
    }

    out.push(`${branchIndent}: (`);
    printConditionalBranchBody(branch, level + 2, ctx, out);
    out.push(`${branchIndent})`);
  }

  if (hasCondition && (!branches.length || branches[branches.length - 1].test)) {
    const leafIndent = createIndent(level + 1, ctx);
    out.push(`${leafIndent}: null`);
  }

  out.push(`${indent}}`);
}

function printConditionalBranchBody(
  branch: IrConditionalBranch,
  level: number,
  ctx: JsxPrinterContext,
  out: string[]
) {
  if (!branch.children.length) {
    const indent = createIndent(level, ctx);
    out.push(`${indent}null`);
    return;
  }

  printNodeList(branch.children, level, ctx, out);
}

function createIndent(level: number, ctx: JsxPrinterContext): string {
  if (level <= 0) {
    return '';
  }

  return ctx.indentUnit.repeat(level);
}
