import { dirname, join } from 'path';
import type { TextDocument} from 'vscode';
import { FileType, Location, Position, Range, Uri, languages, workspace, type DefinitionLink } from 'vscode';
import type { FeatureContext } from '../types';
import type { ElementNode, Node } from '../../format/parser/ast';
import type { SourceSpan } from '../../format/parser/diagnostics';
import { getParsedDocument } from '../../lang/cache';
import { findHtmlAnchorsByLogicalId } from '../../lang/navigation';
import { getById } from '../../lang/templateIndex';
import { isFeatureFlagEnabled } from '../featureFlags';
import { resolveCollieConfigForDocument } from '../../config/collieConfig';
import { getCssClassIndexForDocument } from '../css/indexer';
import * as ts from 'typescript';

const COMPONENT_EXTENSIONS = ['.collie', '.tsx'] as const;
const CACHE_TTL_MS = 5000;
const COLLIE_COMPONENT_NAMES = new Set(['Collie']);

interface DefinitionCacheEntry {
  uri: Uri | null;
  expires: number;
}

const definitionCache = new Map<string, DefinitionCacheEntry>();

function shouldHandleDocument(document: TextDocument): boolean {
  return document.languageId === 'collie';
}

function isTsxDocument(document: TextDocument): boolean {
  return document.languageId === 'typescriptreact' || document.languageId === 'javascriptreact';
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function spanContains(span: SourceSpan | undefined, offset: number): boolean {
  if (!span) {
    return false;
  }
  return offset >= span.start.offset && offset < span.end.offset;
}

interface ClassReference {
  classes: string[];
  span: SourceSpan;
}

function buildAliasMap(parsed: ReturnType<typeof getParsedDocument>): Map<string, string[]> {
  const aliases = parsed.ast.classAliases?.aliases ?? [];
  const map = new Map<string, string[]>();
  for (const alias of aliases) {
    map.set(alias.name, alias.classes);
  }
  return map;
}

function findClassReference(
  parsed: ReturnType<typeof getParsedDocument>,
  offset: number
): ClassReference | null {
  const aliasMap = buildAliasMap(parsed);

  const visitNode = (node: Node): ClassReference | null => {
    if (node.type === 'Element') {
      const spans = node.classSpans ?? [];
      for (let index = 0; index < node.classes.length; index++) {
        const span = spans[index];
        if (!span || !spanContains(span, offset)) {
          continue;
        }
        const token = node.classes[index];
        const aliasMatch = token.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
        if (aliasMatch) {
          const aliasName = aliasMatch[1];
          const expanded = aliasMap.get(aliasName);
          if (!expanded) {
            return null;
          }
          return { classes: expanded, span };
        }
        return { classes: [token], span };
      }

      for (const child of node.children) {
        const match = visitNode(child);
        if (match) {
          return match;
        }
      }
      return null;
    }

    if (node.type === 'Conditional') {
      for (const branch of node.branches) {
        for (const child of branch.body) {
          const match = visitNode(child);
          if (match) {
            return match;
          }
        }
      }
      return null;
    }

    if (node.type === 'ForLoop') {
      for (const child of node.body) {
        const match = visitNode(child);
        if (match) {
          return match;
        }
      }
    }

    return null;
  };

  for (const child of parsed.ast.children) {
    const match = visitNode(child);
    if (match) {
      return match;
    }
  }

  return null;
}

/**
 * Attempts to provide definition for ID directive navigation (Collie → HTML).
 * Returns definition links if cursor is on the ID directive value, undefined otherwise.
 */
async function provideIdDirectiveDefinition(
  document: TextDocument,
  position: Position,
  context: FeatureContext
): Promise<DefinitionLink[] | undefined> {
  try {
    const parsed = getParsedDocument(document);
    const offset = document.offsetAt(position);

    // Check if cursor is on the ID directive value
    if (!parsed.ast.idSpan || !spanContains(parsed.ast.idSpan, offset)) {
      return undefined;
    }

    // Get the logical ID
    const logicalId = parsed.ast.id;
    if (!logicalId) {
      return undefined;
    }

    // Find HTML anchors for this template ID
    const htmlAnchors = findHtmlAnchorsByLogicalId(logicalId);
    if (htmlAnchors.length === 0) {
      return undefined;
    }

    // Create definition links for each HTML anchor
    const definitionLinks: DefinitionLink[] = [];

    for (const anchor of htmlAnchors) {
      for (const range of anchor.ranges) {
        definitionLinks.push({
          targetUri: anchor.uri,
          targetRange: range,
          targetSelectionRange: range
        });
      }
    }

    return definitionLinks.length > 0 ? definitionLinks : undefined;
  } catch (error) {
    context.logger.error('ID directive definition provider failed.', error);
    return undefined;
  }
}

function findComponentNode(nodes: Node[], offset: number): ElementNode | null {
  for (const node of nodes) {
    if (node.type === 'Element') {
      if (node.nameSpan && spanContains(node.nameSpan, offset) && isComponentName(node.name)) {
        return node;
      }
      const childMatch = findComponentNode(node.children, offset);
      if (childMatch) {
        return childMatch;
      }
    } else if (node.type === 'Conditional') {
      for (const branch of node.branches) {
        const childMatch = findComponentNode(branch.body, offset);
        if (childMatch) {
          return childMatch;
        }
      }
    }
  }
  return null;
}

interface CollieIdReference {
  id: string;
  range: Range;
}

function findCollieIdReference(
  document: TextDocument,
  position: Position
): CollieIdReference | null {
  const sourceFile = ts.createSourceFile(
    document.uri.fsPath,
    document.getText(),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const offset = document.offsetAt(position);
  let result: CollieIdReference | null = null;

  const visit = (node: ts.Node): void => {
    if (result) {
      return;
    }

    if (ts.isJsxAttribute(node)) {
      if (!ts.isIdentifier(node.name) || node.name.text !== 'id') {
        return;
      }

      const initializer = node.initializer;
      if (!initializer || !ts.isStringLiteralLike(initializer)) {
        return;
      }

      const attributes = node.parent;
      const opening = attributes?.parent;
      if (!opening || (!ts.isJsxOpeningElement(opening) && !ts.isJsxSelfClosingElement(opening))) {
        return;
      }

      const tagName = opening.tagName;
      if (!ts.isIdentifier(tagName) || !COLLIE_COMPONENT_NAMES.has(tagName.text)) {
        return;
      }

      const valueStart = initializer.getStart(sourceFile) + 1;
      const valueEnd = Math.max(initializer.getEnd() - 1, valueStart);
      if (offset < valueStart || offset > valueEnd) {
        return;
      }

      result = {
        id: initializer.text,
        range: new Range(document.positionAt(valueStart), document.positionAt(valueEnd))
      };
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return result;
}

async function provideTsxDefinition(
  document: TextDocument,
  position: Position,
  context: FeatureContext
): Promise<Location | DefinitionLink[] | undefined> {
  if (!isTsxDocument(document) || !isFeatureFlagEnabled('navigation')) {
    return undefined;
  }

  try {
    const reference = findCollieIdReference(document, position);
    if (!reference?.id) {
      return undefined;
    }

    const entry = getById(reference.id);
    if (!entry) {
      return undefined;
    }

    return [
      {
        targetUri: entry.uri,
        targetRange: entry.idRange,
        targetSelectionRange: entry.idRange,
        originSelectionRange: reference.range
      }
    ];
  } catch (error) {
    context.logger.error('TSX Collie definition provider failed.', error);
    return undefined;
  }
}

async function listSiblingDirectories(dirPath: string): Promise<string[]> {
  const dirs = new Set<string>([dirPath]);
  const parent = dirname(dirPath);
  let entries: [string, FileType][] = [];
  try {
    entries = await workspace.fs.readDirectory(Uri.file(parent));
  } catch {
    return Array.from(dirs);
  }

  for (const [name, type] of entries) {
    if (type === FileType.Directory) {
      dirs.add(join(parent, name));
    }
  }
  return Array.from(dirs);
}

async function resolveComponentUri(document: TextDocument, componentName: string): Promise<Uri | null> {
  const docDir = dirname(document.uri.fsPath);
  const cacheKey = `${docDir}:${componentName}`;
  const now = Date.now();
  const cached = definitionCache.get(cacheKey);
  if (cached && cached.expires > now) {
    return cached.uri;
  }

  const candidateDirs = await listSiblingDirectories(docDir);
  for (const dir of candidateDirs) {
    for (const ext of COMPONENT_EXTENSIONS) {
      const candidate = Uri.file(join(dir, `${componentName}${ext}`));
      try {
        await workspace.fs.stat(candidate);
        definitionCache.set(cacheKey, { uri: candidate, expires: now + CACHE_TTL_MS });
        return candidate;
      } catch {
        // ignore
      }
    }
  }

  definitionCache.set(cacheKey, { uri: null, expires: now + CACHE_TTL_MS });
  return null;
}

async function provideDefinition(document: TextDocument, position: Position, context: FeatureContext) {
  if (!shouldHandleDocument(document) || !isFeatureFlagEnabled('navigation')) {
    return undefined;
  }

  try {
    // First, check if cursor is on ID directive (Collie → HTML navigation)
    const idDefinition = await provideIdDirectiveDefinition(document, position, context);
    if (idDefinition) {
      return idDefinition;
    }
    const parsed = getParsedDocument(document);
    const offset = document.offsetAt(position);

    const config = await resolveCollieConfigForDocument(document, context.logger);
    if (config.flags.enableCssIndex) {
      const classRef = findClassReference(parsed, offset);
      if (classRef) {
        const index = getCssClassIndexForDocument(document);
        if (index) {
          const locations: Location[] = [];
          const seen = new Set<string>();
          for (const className of classRef.classes) {
            const definitions = index.getDefinitions(className);
            for (const def of definitions) {
              const key = `${def.uri.toString()}:${def.range.start.line}:${def.range.start.character}:${def.range.end.line}:${def.range.end.character}`;
              if (seen.has(key)) {
                continue;
              }
              seen.add(key);
              locations.push(new Location(def.uri, def.range));
            }
          }
          if (locations.length > 0) {
            return locations;
          }
        }
      }
    }

    // Otherwise, handle component references (existing behavior)
    const targetNode = findComponentNode(parsed.ast.children, offset);
    if (!targetNode) {
      return undefined;
    }

    const targetUri = await resolveComponentUri(document, targetNode.name);
    if (!targetUri) {
      return undefined;
    }

    return new Location(targetUri, new Position(0, 0));
  } catch (error) {
    context.logger.error('Collie definition provider failed.', error);
    return undefined;
  }
}

export function registerDefinitionProvider(context: FeatureContext) {
  const provider = languages.registerDefinitionProvider({ language: 'collie' }, {
    provideDefinition(document, position) {
      return provideDefinition(document, position, context);
    }
  });
  const tsxProvider = languages.registerDefinitionProvider(
    [{ language: 'typescriptreact' }, { language: 'javascriptreact' }],
    {
      provideDefinition(document, position) {
        return provideTsxDefinition(document, position, context);
      }
    }
  );

  context.register(provider);
  context.register(tsxProvider);
  const clearDefinitionCache = () => {
    definitionCache.clear();
  };
  context.register(
    workspace.onDidChangeWorkspaceFolders(() => {
      clearDefinitionCache();
    })
  );
  context.register(
    workspace.onDidCreateFiles(() => {
      clearDefinitionCache();
    })
  );
  context.register(
    workspace.onDidDeleteFiles(() => {
      clearDefinitionCache();
    })
  );
  context.register(
    workspace.onDidRenameFiles(() => {
      clearDefinitionCache();
    })
  );
  context.logger.info('Collie definition provider registered.');
}
