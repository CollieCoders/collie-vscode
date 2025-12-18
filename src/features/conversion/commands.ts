import { commands } from 'vscode';
import type { FeatureContext } from '..';
import { registerFeature } from '..';

const CONVERT_TSX_SELECTION_CMD = 'collie.convertTsxSelectionToCollie';
const COPY_AS_JSX_CMD = 'collie.copyAsJsx';
const COPY_AS_TSX_CMD = 'collie.copyAsTsx';

function registerConversionCommands(ctx: FeatureContext) {
  ctx.register(
    commands.registerCommand(CONVERT_TSX_SELECTION_CMD, async () => {
      const { runConvertTsxSelectionToCollie } = await import('./convertSelectionCommand');
      await runConvertTsxSelectionToCollie(ctx);
    })
  );

  ctx.register(
    commands.registerCommand(COPY_AS_JSX_CMD, async () => {
      const { runCopyCollieAsJsx } = await import('./collieExportCommandsImpl');
      await runCopyCollieAsJsx(ctx);
    })
  );

  ctx.register(
    commands.registerCommand(COPY_AS_TSX_CMD, async () => {
      const { runCopyCollieAsTsx } = await import('./collieExportCommandsImpl');
      await runCopyCollieAsTsx(ctx);
    })
  );

  ctx.logger.info('Collie conversion commands registered (lazy-loaded implementations).');
}

registerFeature(registerConversionCommands);
