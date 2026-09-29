// Bundles the Lambda handler into a single file and zips it for deployment.
// Cross-platform (Node only) so it works identically on Windows/macOS/Linux.
import { build } from 'esbuild';
// Fails the build on invalid SDL - see the comment in check-schema.mjs.
import './check-schema.mjs';
import AdmZip from 'adm-zip';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(root, 'dist/lambda.js');
const zipFile = resolve(root, 'dist/function.zip');

mkdirSync(resolve(root, 'dist'), { recursive: true });

await build({
  entryPoints: [resolve(root, 'lambda.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: outFile,
  minify: true,
  sourcemap: false,
  // aws-sdk is provided by the Lambda runtime; nothing else is external.
});

const zip = new AdmZip();
// Lambda handler path is "lambda.handler" → file must be lambda.js at the zip root.
zip.addLocalFile(outFile);
zip.writeZip(zipFile);

console.info(`Bundled ${outFile} and wrote ${zipFile}`);
