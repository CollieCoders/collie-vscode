import { build, context } from 'esbuild';

const isWatch = process.argv.includes('--watch');
const isProd = !isWatch;

const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.cjs',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  treeShaking: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development')
  },
  sourcemap: isWatch ? 'inline' : false,
  sourcesContent: isWatch,
  minify: isProd,
  legalComments: 'none',
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
