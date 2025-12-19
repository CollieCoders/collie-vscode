import { Hover, MarkdownString, languages, TextDocument } from 'vscode';
import type { Position } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import type {
  ClassAliasDecl,
  ConditionalNode,
  Node,
  PropsDecl,
  PropsField,
  RootNode,
  TextNode
} from '../../format/parser/ast';
import type { SourceSpan } from '../../format/parser/diagnostics';
import { getParsedDocument } from '../../lang/cache';
import { isFeatureFlagEnabled } from '../featureFlags';

type DirectiveKind = '@if' | '@elseIf' | '@else';

const DIRECTIVE_HOVER_CONTENT: Record<DirectiveKind, { description: string; example: string }> = {
  '@if': {
    description: 'Start a conditional block that renders when the expression is truthy.',
    example: `@if (condition)\n  div.content`
  },
  '@elseIf': {
    description: 'Optional branch evaluated when previous conditions fail.',
    example: `@elseIf (otherCondition)\n  span.note`
  },
  '@else': {
    description: 'Fallback branch rendered when all previous conditions fail.',
    example: `@else\n  | Fallback content`
  }
};

const EXPRESSION_HOVER_TEXT = 'Collie expression *(evaluated in component scope)*.';

function createExpressionHover(): Hover {
  const md = new MarkdownString(EXPRESSION_HOVER_TEXT);
  md.isTrusted = false;
  return new Hover(md);
}

function shouldHandleDocument(document: TextDocument): boolean {
  return document.languageId === 'collie';
}

function spanContains(span: SourceSpan | undefined, offset: number): boolean {
  if (!span) {
    return false;
  }
  return offset >= span.start.offset && offset < span.end.offset;
}

function createDirectiveHover(kind: DirectiveKind): Hover {
  const content = DIRECTIVE_HOVER_CONTENT[kind];
  const md = new MarkdownString();
  md.appendMarkdown(`**${kind}** — ${content.description}\n\n`);
  md.appendCodeblock(content.example, 'collie');
  return new Hover(md);
}

function createPropsHover(field: PropsField): Hover {
  const optional = field.optional ? '?' : '';
  const md = new MarkdownString();
  md.appendMarkdown(`**${field.name}${optional}**: \`${field.typeText}\`\n\nDefined in the props block.`);
  return new Hover(md);
}

function getDirectiveHover(offset: number, nodes: Node[]): Hover | undefined {
  for (const node of nodes) {
    if (node.type === 'Conditional') {
      const hover = getConditionalDirectiveHover(node, offset);
      if (hover) {
        return hover;
      }
      for (const branch of node.branches) {
        const childHover = getDirectiveHover(offset, branch.body);
        if (childHover) {
          return childHover;
        }
      }
    } else if (node.type === 'Element') {
      const inner = getDirectiveHover(offset, node.children);
      if (inner) {
        return inner;
      }
    }
  }
  return undefined;
}

function getConditionalDirectiveHover(node: ConditionalNode, offset: number): Hover | undefined {
  for (let index = 0; index < node.branches.length; index++) {
    const branch = node.branches[index];
    if (!spanContains(branch.span, offset)) {
      continue;
    }

    if (index === 0) {
      return createDirectiveHover('@if');
    }
    if (branch.test) {
      return createDirectiveHover('@elseIf');
    }
    return createDirectiveHover('@else');
  }
  return undefined;
}

function getPropsHover(offset: number, props?: PropsDecl): Hover | undefined {
  if (!props) {
    return undefined;
  }

  for (const field of props.fields) {
    if (spanContains(field.span, offset)) {
      return createPropsHover(field);
    }
  }
  return undefined;
}

function hasExpressionHover(offset: number, nodes: Node[]): boolean {
  for (const node of nodes) {
    switch (node.type) {
      case 'Expression':
        if (spanContains(node.span, offset)) {
          return true;
        }
        break;
      case 'Text':
        if (textNodeContainsExpression(node, offset)) {
          return true;
        }
        break;
      case 'Element':
        if (hasExpressionHover(offset, node.children)) {
          return true;
        }
        break;
      case 'Conditional':
        for (const branch of node.branches) {
          if (hasExpressionHover(offset, branch.body)) {
            return true;
          }
        }
        break;
      default:
        break;
    }
  }
  return false;
}

function textNodeContainsExpression(node: TextNode, offset: number): boolean {
  for (const part of node.parts) {
    if (part.type === 'expr' && spanContains(part.span, offset)) {
      return true;
    }
  }
  return false;
}

function provideHover(document: TextDocument, position: Position, context: FeatureContext): Hover | undefined {
  if (!shouldHandleDocument(document) || !isFeatureFlagEnabled('hover')) {
    return undefined;
  }

  try {
    const parsed = getParsedDocument(document);
    const offset = document.offsetAt(position);

    const directiveHover = getDirectiveHover(offset, parsed.ast.children);
    if (directiveHover) {
      return directiveHover;
    }

    const propsHover = getPropsHover(offset, parsed.ast.props);
    if (propsHover) {
      return propsHover;
    }

    const aliasHover = getClassAliasHover(offset, parsed.ast);
    if (aliasHover) {
      return aliasHover;
    }

    if (hasExpressionHover(offset, parsed.ast.children)) {
      return createExpressionHover();
    }
  } catch (error) {
    context.logger.error('Collie hover provider failed.', error);
  }

  return undefined;
}

function activateHoverFeature(context: FeatureContext) {
  const provider = languages.registerHoverProvider({ language: 'collie' }, {
    provideHover(document, position) {
      return provideHover(document, position, context);
    }
  });

  context.register(provider);
  context.logger.info('Collie hover provider registered.');
}

registerFeature(activateHoverFeature);

function getClassAliasHover(offset: number, root: RootNode): Hover | undefined {
  const decl = root.classAliases;
  if (!decl) {
    return undefined;
  }

  for (const alias of decl.aliases) {
    if (spanContains(alias.nameSpan ?? alias.span, offset)) {
      return createAliasHover(alias);
    }
  }

  if (!decl.aliases.length) {
    return undefined;
  }

  const aliasMap = new Map<string, ClassAliasDecl>();
  for (const alias of decl.aliases) {
    aliasMap.set(alias.name, alias);
  }

  for (const child of root.children) {
    const hover = findAliasUsageHover(offset, child, aliasMap);
    if (hover) {
      return hover;
    }
  }

  return undefined;
}

function findAliasUsageHover(
  offset: number,
  node: Node,
  aliasMap: Map<string, ClassAliasDecl>
): Hover | undefined {
  if (node.type === 'Element') {
    const spans = node.classSpans ?? [];
    for (let index = 0; index < spans.length; index++) {
      if (!spanContains(spans[index], offset)) {
        continue;
      }
      const aliasName = extractAliasName(node.classes[index]);
      if (!aliasName) {
        continue;
      }
      const alias = aliasMap.get(aliasName);
      if (alias) {
        return createAliasHover(alias);
      }
      return undefined;
    }
    for (const child of node.children) {
      const hover = findAliasUsageHover(offset, child, aliasMap);
      if (hover) {
        return hover;
      }
    }
    return undefined;
  }

  if (node.type === 'Conditional') {
    for (const branch of node.branches) {
      for (const child of branch.body) {
        const hover = findAliasUsageHover(offset, child, aliasMap);
        if (hover) {
          return hover;
        }
      }
    }
  }

  return undefined;
}

function extractAliasName(token: string): string | null {
  const match = token.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
  return match ? match[1] : null;
}

function createAliasHover(alias: ClassAliasDecl): Hover {
  const md = new MarkdownString(undefined, true);
  md.appendCodeblock(`$${alias.name}`, 'collie');
  if (alias.classes.length) {
    md.appendMarkdown('\nExpands to:\n\n');
    md.appendCodeblock(alias.classes.join(' '), 'css');
  }
  md.isTrusted = true;
  return new Hover(md);
}
