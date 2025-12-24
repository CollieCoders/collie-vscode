import { dirname, join } from 'path';
import { FileType, Location, Position, Range, Uri, languages, TextDocument, workspace, type DefinitionLink } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import type { ElementNode, Node } from '../../format/parser/ast';
import type { SourceSpan } from '../../format/parser/diagnostics';
import { getParsedDocument } from '../../lang/cache';
import { findHtmlAnchorsByLogicalId } from '../../lang/navigation';
import { isFeatureFlagEnabled } from '../featureFlags';

const COMPONENT_EXTENSIONS = ['.collie', '.tsx'] as const;
const CACHE_TTL_MS = 5000;

interface DefinitionCacheEntry {
  uri: Uri | null;
  expires: number;
}

const definitionCache = new Map<string, DefinitionCacheEntry>();

function shouldHandleDocument(document: TextDocument): boolean {
  return document.languageId === 'collie';
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
    
    // Otherwise, handle component references (existing behavior)
    const parsed = getParsedDocument(document);
    const offset = document.offsetAt(position);
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

function activateDefinitionFeature(context: FeatureContext) {
  const provider = languages.registerDefinitionProvider({ language: 'collie' }, {
    provideDefinition(document, position) {
      return provideDefinition(document, position, context);
    }
  });

  context.register(provider);
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

registerFeature(activateDefinitionFeature);
