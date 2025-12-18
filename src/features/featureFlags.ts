import { EventEmitter, workspace } from 'vscode';
import type { FeatureContext } from '.';
import { registerFeature } from '.';

export type CollieFeatureFlag = 'diagnostics' | 'completions' | 'navigation';

export interface FeatureFlagSnapshot {
  diagnostics: boolean;
  completions: boolean;
  navigation: boolean;
}

const DEFAULT_FLAGS: FeatureFlagSnapshot = {
  diagnostics: false,
  completions: false,
  navigation: false
};

let currentFlags: FeatureFlagSnapshot = readFeatureFlags();

const flagEmitter = new EventEmitter<FeatureFlagSnapshot>();

export const onDidChangeFeatureFlags = flagEmitter.event;

export function getFeatureFlags(): FeatureFlagSnapshot {
  return currentFlags;
}

export function isFeatureFlagEnabled(flag: CollieFeatureFlag): boolean {
  return currentFlags[flag];
}

function readFeatureFlags(): FeatureFlagSnapshot {
  const config = workspace.getConfiguration('collie');
  return {
    diagnostics: config.get<boolean>('features.diagnostics', DEFAULT_FLAGS.diagnostics),
    completions: config.get<boolean>('features.completions', DEFAULT_FLAGS.completions),
    navigation: config.get<boolean>('features.navigation', DEFAULT_FLAGS.navigation)
  };
}

function snapshotsEqual(a: FeatureFlagSnapshot, b: FeatureFlagSnapshot): boolean {
  return a.diagnostics === b.diagnostics && a.completions === b.completions && a.navigation === b.navigation;
}

function activateFeatureFlagWatcher(context: FeatureContext) {
  currentFlags = readFeatureFlags();

  const configListener = workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('collie.features')) {
      const updated = readFeatureFlags();
      if (!snapshotsEqual(updated, currentFlags)) {
        currentFlags = updated;
        flagEmitter.fire(currentFlags);
        context.logger.info('Collie feature flags updated.', currentFlags);
      }
    }
  });

  context.register(flagEmitter);
  context.register(configListener);
  context.logger.info('Collie feature flag system initialized.');
}

registerFeature(activateFeatureFlagWatcher);
