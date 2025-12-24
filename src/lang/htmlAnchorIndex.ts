import { workspace, Uri, TextDocument, EventEmitter, Event } from 'vscode';
// import * as path from 'path';

// Maps logical template ID -> Set of HTML file URIs that contain id="<id>-collie"
const htmlAnchorIndex = new Map<string, Set<string>>();

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
  
  // Add new anchors found in this file
  const anchors = extractCollieAnchorsFromHtml(htmlContent);
  for (const logicalId of anchors) {
    if (!htmlAnchorIndex.has(logicalId)) {
      htmlAnchorIndex.set(logicalId, new Set());
    }
    htmlAnchorIndex.get(logicalId)!.add(uriString);
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
 * Clears the entire HTML anchor index.
 */
export function clearHtmlAnchorIndex(): void {
  htmlAnchorIndex.clear();
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
