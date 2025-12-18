import type { FeatureContext } from '..';
import { registerFeature } from '..';

// Placeholder for future Collie formatter integration
function activateFormattingFeature(_ctx: FeatureContext) {
  // Formatting support will hook into VS Code formatting APIs here.
}

registerFeature(activateFormattingFeature);
