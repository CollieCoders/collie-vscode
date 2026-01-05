import type { FeatureContext, FeatureRegistration } from './types';

export async function runFeature(
  name: string,
  fn: FeatureRegistration,
  featureContext: FeatureContext
) {
  try {
    const result = fn(featureContext);
    if (result && typeof (result as Promise<void>).then === 'function') {
      await result;
    }
  } catch (error) {
    featureContext.logger.error(`Collie feature activation failed (${name}).`, error);
  }
}
