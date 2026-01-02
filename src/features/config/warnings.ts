import { RelativePattern, window, workspace, type TextDocument } from 'vscode';
import type { FeatureContext } from '..';
import { resolveCollieConfigForDocument } from '../../config/collieConfig';

const WARNED_KEYS_STORAGE = 'collie.warnedKeys';
const warnedKeys = new Set<string>();
const toolingCheckedKeys = new Set<string>();

async function warnOnce(context: FeatureContext, key: string, message: string): Promise<void> {
  const stored = context.extensionContext.workspaceState.get<string[]>(WARNED_KEYS_STORAGE, []);
  if (warnedKeys.has(key) || stored.includes(key)) {
    warnedKeys.add(key);
    return;
  }

  warnedKeys.add(key);
  await context.extensionContext.workspaceState.update(WARNED_KEYS_STORAGE, [...stored, key]);
  window.showWarningMessage(message);
}

function getWorkspaceKey(document: TextDocument): string {
  const folder = workspace.getWorkspaceFolder(document.uri);
  return folder ? folder.uri.toString() : document.uri.toString();
}

export async function warnIfMissingConfig(
  document: TextDocument,
  context: FeatureContext,
  configPath?: string
): Promise<void> {
  const resolvedPath = configPath ?? (await resolveCollieConfigForDocument(document, context.logger)).configPath;
  if (resolvedPath) {
    return;
  }

  const key = `missingConfig:${getWorkspaceKey(document)}`;
  await warnOnce(
    context,
    key,
    'No collie.config.* found for this workspace. Run `collie init` to create one.'
  );
}

export async function warnIfMissingTooling(document: TextDocument, context: FeatureContext): Promise<void> {
  const workspaceKey = getWorkspaceKey(document);
  const checkKey = `toolingChecked:${workspaceKey}`;
  if (toolingCheckedKeys.has(checkKey)) {
    return;
  }
  toolingCheckedKeys.add(checkKey);

  const folder = workspace.getWorkspaceFolder(document.uri);
  if (!folder) {
    return;
  }

  const exclude = '**/node_modules/**/node_modules/**';
  const colliePackage = await workspace.findFiles(
    new RelativePattern(folder, '**/node_modules/collie/package.json'),
    exclude,
    1
  );
  const scopedPackages = await workspace.findFiles(
    new RelativePattern(folder, '**/node_modules/@collie/*/package.json'),
    exclude,
    1
  );

  if (colliePackage.length > 0 || scopedPackages.length > 0) {
    return;
  }

  const key = `missingTooling:${workspaceKey}`;
  await warnOnce(
    context,
    key,
    'Collie tooling packages were not found in node_modules. Install dependencies or run `collie init`.'
  );
}
