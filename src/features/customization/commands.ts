import { commands, ConfigurationTarget, window } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';
import type { CollieSemanticTokenType } from '../semanticTokens/legend';
import { applyTokenCustomizationRule, removeTokenCustomizationRule } from './settingsWriter';
import { promptColorValue, promptConfigurationTarget, promptStyleSelection, promptTokenType } from './ui';

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

function describeTarget(target: ConfigurationTarget) {
  return target === ConfigurationTarget.Workspace ? 'workspace' : 'user';
}

async function runCustomizationFlow(tokenTypePreset?: CollieSemanticTokenType) {
  const target = await promptConfigurationTarget();
  if (!target) {
    return;
  }

  const tokenType = tokenTypePreset ?? (await promptTokenType(tokenTypePreset));
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

  const tokenType = await promptTokenType();
  if (!tokenType) {
    return;
  }

  await removeTokenCustomizationRule(tokenType, target);
  window.showInformationMessage(`Reset ${tokenType} customization in ${describeTarget(target)} settings.`);
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
}

registerFeature(registerCustomizationCommands);
