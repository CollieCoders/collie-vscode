import { ConfigurationTarget, QuickPickItem, window } from 'vscode';
import type { CollieSemanticTokenType } from '../semanticTokens/legend';
import { collieSemanticTokenTypes } from '../semanticTokens/legend';

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

interface ColorQuickPickItem extends QuickPickItem {
  value: string;
}

const COLOR_PRESETS: ColorQuickPickItem[] = [
  { label: 'Lavender', description: '#C586C0', value: '#C586C0' },
  { label: 'Gold', description: '#DCDCAA', value: '#DCDCAA' },
  { label: 'Mint', description: '#4EC9B0', value: '#4EC9B0' },
  { label: 'Sky', description: '#569CD6', value: '#569CD6' },
  { label: 'Peach', description: '#CE9178', value: '#CE9178' },
  { label: 'Slate', description: '#9CDCFE', value: '#9CDCFE' },
  { label: 'Rose', description: '#F44747', value: '#F44747' },
  { label: 'Custom hex…', description: 'Enter a custom #RGB/#RRGGBB value', value: 'custom' }
];

interface TargetQuickPickItem extends QuickPickItem {
  target: ConfigurationTarget;
}

const TARGET_OPTIONS: TargetQuickPickItem[] = [
  {
    label: 'Workspace',
    description: 'Only this workspace',
    target: ConfigurationTarget.Workspace
  },
  {
    label: 'User',
    description: 'All Collie workspaces',
    target: ConfigurationTarget.Global
  }
];

interface StyleQuickPickItem extends QuickPickItem {
  style: 'bold' | 'italic' | 'underline';
}

const STYLE_OPTIONS: StyleQuickPickItem[] = [
  { label: 'Bold', style: 'bold' },
  { label: 'Italic', style: 'italic' },
  { label: 'Underline', style: 'underline' }
];

export async function promptConfigurationTarget(): Promise<ConfigurationTarget | undefined> {
  const selection = await window.showQuickPick(TARGET_OPTIONS, {
    placeHolder: 'Apply customization to workspace or user settings?'
  });
  return selection?.target;
}

export async function promptTokenType(initial?: CollieSemanticTokenType): Promise<CollieSemanticTokenType | undefined> {
  const selection = await window.showQuickPick(
    collieSemanticTokenTypes.map(tokenType => ({
      label: tokenType,
      picked: tokenType === initial
    })),
    {
      placeHolder: 'Which Collie token category do you want to customize?'
    }
  );

  if (!selection) {
    return undefined;
  }

  return selection.label as CollieSemanticTokenType;
}

export async function promptColorValue(): Promise<string | undefined> {
  const selection = await window.showQuickPick(COLOR_PRESETS, {
    placeHolder: 'Choose a color for the selected token type'
  });

  if (!selection) {
    return undefined;
  }

  if (selection.value === 'custom') {
    const input = await window.showInputBox({
      prompt: 'Enter a custom hex color (#RGB or #RRGGBB)',
      validateInput(value) {
        return HEX_COLOR_PATTERN.test(value) ? undefined : 'Use #RGB or #RRGGBB format.';
      }
    });
    return input;
  }

  return selection.value;
}

export interface StyleSelection {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export async function promptStyleSelection(): Promise<StyleSelection | undefined> {
  const picks = await window.showQuickPick(STYLE_OPTIONS, {
    placeHolder: 'Toggle optional font styles (Esc to keep defaults)',
    canPickMany: true
  });

  if (picks === undefined) {
    return undefined;
  }

  const styles: StyleSelection = {};
  for (const pick of picks) {
    styles[pick.style] = true;
  }

  return styles;
}
