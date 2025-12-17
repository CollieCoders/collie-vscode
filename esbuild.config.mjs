import { build, context } from 'esbuild';

const isWatch = process.argv.includes('--watch');

const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.cjs',
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  external: ['vscode'],
  logLevel: 'info'
};

(async () => {
  if (isWatch) {
    const ctx = await context(config);
    await ctx.watch();
    console.log('Watching Collie extension sources...');
  } else {
    await build(config);
    console.log('Built Collie extension bundle');
  }
})();
