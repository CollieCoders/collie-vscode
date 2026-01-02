import { commands } from 'vscode';
import type { FeatureContext } from '..';

// Alias commands exist only to provide short context-menu titles.
// They forward to the canonical implementations.

const CONVERT_TSX_SELECTION_CMD = 'collie.convertTsxSelectionToCollie';
const CONVERT_TSX_SELECTION_MENU_CMD = 'collie.convertToCollie';
const COPY_AS_JSX_CMD = 'collie.copyAsJsx';
const COPY_AS_TSX_CMD = 'collie.copyAsTsx';
const COPY_AS_TSX_MENU_CMD = 'collie.convertToTsxClipboard';

export function registerConversionCommands(ctx: FeatureContext) {
  ctx.logger.info('Registering commands...');

  ctx.register(
    commands.registerCommand(CONVERT_TSX_SELECTION_CMD, async () => {
      const { runConvertTsxSelectionToCollie } = await import('./convertSelectionCommand');
      await runConvertTsxSelectionToCollie(ctx);
    })
  );

  ctx.register(
    commands.registerCommand(CONVERT_TSX_SELECTION_MENU_CMD, async () => {
      const { runConvertTsxSelectionToCollie } = await import('./convertSelectionCommand');
      await runConvertTsxSelectionToCollie(ctx);
    })
  );

  ctx.logger.info('Registered command collie.convertToCollie');

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

  ctx.register(
    commands.registerCommand(COPY_AS_TSX_MENU_CMD, async () => {
      const { runCopyCollieAsTsx } = await import('./collieExportCommandsImpl');
      await runCopyCollieAsTsx(ctx);
    })
  );

  ctx.logger.info('Collie conversion commands registered (lazy-loaded implementations).');
}
