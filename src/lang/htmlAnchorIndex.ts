import { workspace, Uri, TextDocument, EventEmitter, Event, Range, Position } from 'vscode';
// import * as path from 'path';

// Maps logical template ID -> Set of HTML file URIs that contain id="<id>-collie"
const htmlAnchorIndex = new Map<string, Set<string>>();

// Maps "uriString:logicalId" -> Range[] for efficient range lookups
const htmlAnchorRanges = new Map<string, Range[]>();

// Event emitter for when HTML anchors change
const onHtmlAnchorsChangedEmitter = new EventEmitter<void>();
export const onHtmlAnchorsChanged: Event<void> = onHtmlAnchorsChangedEmitter.event;

/**
 * Extracts all Collie placeholder IDs from an HTML document.
 * Looks for id="*-collie" attributes.
 */
export function extractCollieAnchorsFromHtml(htmlContent: string): string[] {
  const anchors: string[] = [];
  
  // Match id="something-collie" or id='something-collie'
  const idPattern = /\bid=["']([^"']*-collie)["']/gi;
  let match: RegExpExecArray | null;
  
  while ((match = idPattern.exec(htmlContent))) {
    const fullId = match[1];
    // Remove the -collie suffix to get the logical ID
    if (fullId.endsWith('-collie')) {
      const logicalId = fullId.slice(0, -7);
      if (logicalId) {
        anchors.push(logicalId);
      }
    }
  }
  
  return anchors;
}

/**
 * Extracts all Collie placeholder IDs and their ranges from an HTML document.
 * Looks for id="*-collie" attributes.
 */
function extractCollieAnchorsWithRanges(htmlContent: string): Map<string, Range[]> {
  const anchorMap = new Map<string, Range[]>();
  
  // Match id="something-collie" or id='something-collie'
  const idPattern = /\bid=(["'])([^"']*-collie)\1/gi;
  let match: RegExpExecArray | null;
  
  while ((match = idPattern.exec(htmlContent))) {
    const fullId = match[2];
    // Remove the -collie suffix to get the logical ID
    if (fullId.endsWith('-collie')) {
      const logicalId = fullId.slice(0, -7);
      if (logicalId) {
        // Find the position of the ID value itself (not the whole attribute)
        const valueStart = match.index + match[0].indexOf(fullId);
        const valueEnd = valueStart + fullId.length;
        const range = offsetsToRange(htmlContent, valueStart, valueEnd);
        
        if (!anchorMap.has(logicalId)) {
          anchorMap.set(logicalId, []);
        }
        anchorMap.get(logicalId)!.push(range);
      }
    }
  }
  
  return anchorMap;
}

/**
 * Converts character offsets to a VS Code Range.
 */
function offsetsToRange(text: string, start: number, end: number): Range {
  let line = 0;
  let col = 0;
  
  let startPos: Position | undefined;
  let endPos: Position | undefined;
  
  for (let i = 0; i <= text.length; i++) {
    if (i === start) {
      startPos = new Position(line, col);
    }
    if (i === end) {
      endPos = new Position(line, col);
      break;
    }
    
    if (i < text.length && text[i] === '\n') {
      line++;
      col = 0;
    } else {
      col++;
    }
  }
  
  // Fallback positions
  if (!startPos) {
    startPos = new Position(0, 0);
  }
  if (!endPos) {
    endPos = new Position(line, col);
  }
  
  return new Range(startPos, endPos);
}

/**
 * Updates the HTML anchor index for a specific HTML file.
 */
export function updateHtmlAnchors(uri: Uri, htmlContent: string): void {
  const uriString = uri.toString();
  
  // Remove this URI from all existing entries
  for (const [id, uris] of htmlAnchorIndex.entries()) {
    uris.delete(uriString);
    if (uris.size === 0) {
      htmlAnchorIndex.delete(id);
    }
  }
  
  // Remove old range entries for this URI
  const keysToDelete: string[] = [];
  for (const key of htmlAnchorRanges.keys()) {
    if (key.startsWith(uriString + ':')) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    htmlAnchorRanges.delete(key);
  }
  
  // Add new anchors found in this file with their ranges
  const anchorsWithRanges = extractCollieAnchorsWithRanges(htmlContent);
  for (const [logicalId, ranges] of anchorsWithRanges.entries()) {
    if (!htmlAnchorIndex.has(logicalId)) {
      htmlAnchorIndex.set(logicalId, new Set());
    }
    htmlAnchorIndex.get(logicalId)!.add(uriString);
    
    // Store ranges for this URI and logical ID
    const rangeKey = `${uriString}:${logicalId}`;
    htmlAnchorRanges.set(rangeKey, ranges);
  }
  
  // Notify listeners that anchors changed
  onHtmlAnchorsChangedEmitter.fire();
}

/**
 * Removes all anchors associated with a specific HTML file.
 */
export function removeHtmlAnchors(uri: Uri): void {
  const uriString = uri.toString();
  
  for (const [id, uris] of htmlAnchorIndex.entries()) {
    uris.delete(uriString);
    if (uris.size === 0) {
      htmlAnchorIndex.delete(id);
    }
  }
  
  // Remove range entries for this URI
  const keysToDelete: string[] = [];
  for (const key of htmlAnchorRanges.keys()) {
    if (key.startsWith(uriString + ':')) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    htmlAnchorRanges.delete(key);
  }
  
  // Notify listeners that anchors changed
  onHtmlAnchorsChangedEmitter.fire();
}

/**
 * Checks if a template ID has any HTML placeholders.
 */
export function hasHtmlPlaceholder(templateId: string): boolean {
  const uris = htmlAnchorIndex.get(templateId);
  return uris !== undefined && uris.size > 0;
}

/**
 * Gets all HTML files that contain a placeholder for the given template ID.
 */
export function getHtmlPlaceholders(templateId: string): Uri[] {
  const uris = htmlAnchorIndex.get(templateId);
  if (!uris) {
    return [];
  }
  return Array.from(uris).map(uriString => Uri.parse(uriString));
}

/**
 * Gets the ranges where a specific template ID appears in a specific HTML file.
 */
export function getHtmlPlaceholderRanges(uri: Uri, templateId: string): Range[] {
  const rangeKey = `${uri.toString()}:${templateId}`;
  return htmlAnchorRanges.get(rangeKey) || [];
}

/**
 * Clears the entire HTML anchor index.
 */
export function clearHtmlAnchorIndex(): void {
  htmlAnchorIndex.clear();
  htmlAnchorRanges.clear();
}

/**
 * Scans all HTML files in the workspace and builds the initial index.
 */
export async function scanWorkspaceHtmlFiles(): Promise<void> {
  clearHtmlAnchorIndex();
  
  const htmlFiles = await workspace.findFiles('**/*.html', '**/node_modules/**');
  
  for (const uri of htmlFiles) {
    try {
      const document = await workspace.openTextDocument(uri);
      updateHtmlAnchors(uri, document.getText());
    } catch (error) {
      // Ignore files that can't be read
      console.error(`Failed to scan HTML file ${uri.fsPath}:`, error);
    }
  }
}
