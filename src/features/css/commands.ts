import { commands, window, workspace, ConfigurationTarget, type TextDocument, type WorkspaceFolder } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import { resolveCollieConfigForDocument } from '../../config/collieConfig';
import {
  getUnknownClassOverrideSetting,
  ensureCssIndexForWorkspace
} from './indexer';

const UNKNOWN_CLASS_OVERRIDE_KEY = 'collie.css.diagnostics.unknownClassOverride';

function getActiveCollieDocument(): TextDocument | null {
  const editor = window.activeTextEditor;
  if (!editor) {
    return null;
  }
  if (editor.document.languageId !== 'collie') {
    return null;
  }
  return editor.document;
}

function getWorkspaceFolderForDocument(document: TextDocument): WorkspaceFolder | null {
  return workspace.getWorkspaceFolder(document.uri) ?? null;
}

async function showCurrentConfig(context: FeatureContext): Promise<void> {
  const document = getActiveCollieDocument();
  if (!document) {
    window.showWarningMessage('Open a Collie file to show the current config.');
    return;
  }

  const config = await resolveCollieConfigForDocument(document, context.logger);
  const payload = {
    file: document.uri.fsPath,
    configPath: config.configPath ?? null,
    parsed: config.parsed,
    flags: config.flags,
    unknownClassOverride: getUnknownClassOverrideSetting()
  };

  const json = JSON.stringify(payload, null, 2);
  const doc = await workspace.openTextDocument({ content: json, language: 'json' });
  await window.showTextDocument(doc, { preview: false });
}

async function rebuildCssIndex(context: FeatureContext): Promise<void> {
  const document = getActiveCollieDocument();
  if (!document) {
    window.showWarningMessage('Open a Collie file to rebuild the CSS index.');
    return;
  }

  const folder = getWorkspaceFolderForDocument(document);
  if (!folder) {
    window.showWarningMessage('This Collie file is not inside a workspace folder.');
    return;
  }

  const rebuilt = await ensureCssIndexForWorkspace(folder, context);
  if (!rebuilt) {
    window.showInformationMessage('CSS index is not enabled for this workspace.');
    return;
  }

  context.logger.info(`CSS index rebuilt for ${folder.name}.`);
  window.showInformationMessage('CSS index rebuilt.');
}

async function toggleUnknownClassDiagnostics(): Promise<void> {
  const config = workspace.getConfiguration();
  const current = config.get<string>(UNKNOWN_CLASS_OVERRIDE_KEY, 'inherit');
  const next = current === 'off' ? 'on' : 'off';
  await config.update(UNKNOWN_CLASS_OVERRIDE_KEY, next, ConfigurationTarget.Workspace);
  window.showInformationMessage(`Unknown class diagnostics override set to "${next}".`);
}

function activateCssCommands(context: FeatureContext) {
  context.register(
    commands.registerCommand('collie.rebuildCssIndex', () => rebuildCssIndex(context))
  );

  context.register(
    commands.registerCommand('collie.showCurrentConfig', () => showCurrentConfig(context))
  );

  context.register(
    commands.registerCommand('collie.toggleUnknownClassDiagnostics', () => toggleUnknownClassDiagnostics())
  );

  context.logger.info('Collie CSS commands registered.');
}

registerFeature(activateCssCommands);
