import { commands, ConfigurationTarget, env, window, workspace } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import type { CollieSemanticTokenType } from '../semanticTokens/legend';
import { collieSemanticTokenTypes } from '../semanticTokens/legend';
import type { TokenCustomizationRule } from './settingsWriter';
import { applyTokenCustomizationRule, removeTokenCustomizationRule } from './settingsWriter';
import { promptColorValue, promptConfigurationTarget, promptStyleSelection, promptTokenType } from './ui';
import { inferTokenTypeFromContext } from './inference';

interface CustomizationCommand {
  command: string;
  tokenType?: CollieSemanticTokenType;
}

const CUSTOMIZATION_COMMANDS: CustomizationCommand[] = [
  { command: 'collie.customizeTokenColor' },
  { command: 'collie.customizeTagColor', tokenType: 'collieTag' },
  { command: 'collie.customizeDirectiveColor', tokenType: 'collieDirective' },
  { command: 'collie.customizePropsFieldColor', tokenType: 'colliePropsField' },
  { command: 'collie.customizeClassShorthandColor', tokenType: 'collieClassShorthand' }
];

type SemanticTokenCustomizationValue = {
  enabled?: boolean;
  rules?: Record<string, TokenCustomizationRule>;
} | undefined;

const tokenTypeSet = new Set<CollieSemanticTokenType>(collieSemanticTokenTypes as ReadonlyArray<CollieSemanticTokenType>);

function describeTarget(target: ConfigurationTarget) {
  return target === ConfigurationTarget.Workspace ? 'workspace' : 'user';
}

async function runCustomizationFlow(tokenTypePreset?: CollieSemanticTokenType) {
  const target = await promptConfigurationTarget();
  if (!target) {
    return;
  }

  const inferredTokenType = tokenTypePreset ? undefined : inferTokenTypeFromContext();
  const tokenType = tokenTypePreset ?? (await promptTokenType(inferredTokenType));
  if (!tokenType) {
    return;
  }

  const color = await promptColorValue();
  if (!color) {
    return;
  }

  const styleSelection = await promptStyleSelection();
  if (styleSelection === undefined) {
    return;
  }

  await applyTokenCustomizationRule(tokenType, { foreground: color, ...styleSelection }, target);
  window.showInformationMessage(`Updated ${tokenType} highlighting in ${describeTarget(target)} settings.`);
}

async function runResetFlow() {
  const target = await promptConfigurationTarget();
  if (!target) {
    return;
  }

  const inferredTokenType = inferTokenTypeFromContext();
  const tokenType = await promptTokenType(inferredTokenType);
  if (!tokenType) {
    return;
  }

  await removeTokenCustomizationRule(tokenType, target);
  window.showInformationMessage(`Reset ${tokenType} customization in ${describeTarget(target)} settings.`);
}

function getCollieCustomizationSubset(): SemanticTokenCustomizationValue {
  const editorConfig = workspace.getConfiguration('editor');
  const current = editorConfig.get<SemanticTokenCustomizationValue>('semanticTokenColorCustomizations');
  const rules = current?.rules;

  if (!rules) {
    return undefined;
  }

  const collieRules: Record<string, TokenCustomizationRule> = {};

  for (const [tokenType, rule] of Object.entries(rules)) {
    if (tokenTypeSet.has(tokenType as CollieSemanticTokenType)) {
      collieRules[tokenType] = rule;
    }
  }

  if (Object.keys(collieRules).length === 0) {
    return undefined;
  }

  return {
    enabled: current?.enabled ?? true,
    rules: collieRules
  };
}

async function copyCustomizationSnippet() {
  const subset = getCollieCustomizationSubset();
  if (!subset) {
    window.showInformationMessage('No Collie token customizations found to copy.');
    return;
  }

  const snippet = JSON.stringify(
    {
      'editor.semanticTokenColorCustomizations': subset
    },
    null,
    2
  );

  await env.clipboard.writeText(snippet);
  window.showInformationMessage('Copied Collie semantic token customization snippet to clipboard.');
}

async function registerCustomizationCommands(context: FeatureContext) {
  for (const { command, tokenType } of CUSTOMIZATION_COMMANDS) {
    context.register(
      commands.registerCommand(command, () => {
        return runCustomizationFlow(tokenType);
      })
    );
  }

  context.register(commands.registerCommand('collie.resetTokenCustomization', runResetFlow));
  context.register(commands.registerCommand('collie.copyTokenCustomizationSnippet', copyCustomizationSnippet));
}

registerFeature(registerCustomizationCommands);
