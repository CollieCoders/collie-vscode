import { workspace, type Uri } from 'vscode';

/**
 * diagnostic-upgrade: Reads text content from a URI, preferring in-memory open documents.
 * 
 * This is required so diagnostics can see unsaved edits in open editors.
 * Without this, warnings would only clear after saving related files (TSX/CSS/etc),
 * creating a poor user experience during active editing.
 * 
 * @param uri - The URI of the file to read
 * @returns The text content of the file
 */
export async function getTextPreferOpenDoc(uri: Uri): Promise<string> {
  // Check if the document is currently open in the editor
  const openDoc = workspace.textDocuments.find(
    doc => doc.uri.toString() === uri.toString()
  );
  
  if (openDoc) {
    return openDoc.getText();
  }
  
  // Fall back to reading from disk
  const bytes = await workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}
