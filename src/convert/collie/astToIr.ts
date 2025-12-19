import type {
  ClassAliasesDecl,
  ConditionalNode,
  ElementNode,
  ExpressionNode,
  Node,
  PropsDecl,
  RootNode,
  TextNode,
  TextPart
} from '../../format/parser/ast';
import {
  createIrConditional,
  createIrConditionalBranch,
  createIrElement,
  createIrExpression,
  createIrText,
  type IrNode
} from '../ir/nodes';

export function convertCollieAstToIr(root: RootNode): readonly IrNode[] {
  const nodes: IrNode[] = [];
  const aliasEnv = buildAliasEnvironment(root.classAliases);

  if (root.props) {
    nodes.push(createIrExpression(buildPropsComment(root.props)));
  }

  nodes.push(...convertNodes(root.children, aliasEnv));
  return nodes;
}

function convertNodes(
  nodes: readonly Node[],
  aliasEnv: Map<string, readonly string[]>
): IrNode[] {
  const irNodes: IrNode[] = [];

  for (const node of nodes) {
    irNodes.push(...convertNode(node, aliasEnv));
  }

  return irNodes;
}

function convertNode(
  node: Node,
  aliasEnv: Map<string, readonly string[]>
): readonly IrNode[] {
  switch (node.type) {
    case 'Element':
      return [convertElementNode(node, aliasEnv)];
    case 'Text':
      return convertTextNode(node);
    case 'Expression':
      return [convertExpressionNode(node)];
    case 'Conditional':
      return [convertConditionalNode(node, aliasEnv)];
    default:
      return [createFallbackComment(`Unsupported Collie node: ${node.type}`)];
  }
}

function convertElementNode(
  node: ElementNode,
  aliasEnv: Map<string, readonly string[]>
): IrNode {
  const children = convertNodes(node.children, aliasEnv);
  const classes = expandAliasClasses(node.classes, aliasEnv);
  return createIrElement(node.name, {
    classes,
    children
  });
}

function convertTextNode(node: TextNode): IrNode[] {
  const segments: IrNode[] = [];
  let pendingText = '';

  const flushText = () => {
    if (!pendingText) {
      return;
    }
    segments.push(createIrText(pendingText));
    pendingText = '';
  };

  for (const part of node.parts) {
    if (isTextChunk(part)) {
      pendingText += part.value;
      continue;
    }

    flushText();
    segments.push(createIrExpression(part.value));
  }

  flushText();
  return segments;
}

function convertExpressionNode(node: ExpressionNode) {
  return createIrExpression(node.value);
}

function convertConditionalNode(
  node: ConditionalNode,
  aliasEnv: Map<string, readonly string[]>
): IrNode {
  const branches = node.branches.map(branch =>
    createIrConditionalBranch(branch.test, convertNodes(branch.body, aliasEnv))
  );
  return createIrConditional(branches);
}

function isTextChunk(part: TextPart): part is Extract<TextPart, { type: 'text' }> {
  return part.type === 'text';
}

function buildPropsComment(props: PropsDecl): string {
  if (!props.fields.length) {
    return '/* Collie props block present. Add TypeScript props manually. */';
  }

  const summary = props.fields
    .map(field => `${field.name}${field.optional ? '?' : ''}: ${field.typeText}`)
    .join(', ');
  return `/* Collie props: ${summary} */`;
}

function createFallbackComment(reason: string) {
  return createIrExpression(`/* Collie TODO: ${reason} */`);
}

function buildAliasEnvironment(decl?: ClassAliasesDecl): Map<string, readonly string[]> {
  const env = new Map<string, readonly string[]>();
  if (!decl) {
    return env;
  }
  for (const alias of decl.aliases) {
    env.set(alias.name, alias.classes);
  }
  return env;
}

function expandAliasClasses(
  classes: readonly string[],
  aliasEnv: Map<string, readonly string[]>
): readonly string[] {
  if (!classes.length) {
    return classes;
  }
  const result: string[] = [];
  for (const token of classes) {
    const aliasName = extractAliasName(token);
    if (!aliasName) {
      result.push(token);
      continue;
    }
    const aliasClasses = aliasEnv.get(aliasName);
    if (!aliasClasses) {
      continue;
    }
    result.push(...aliasClasses);
  }
  return result;
}

function extractAliasName(token: string): string | null {
  const match = token.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
  return match ? match[1] : null;
}
