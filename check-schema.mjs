// Parse and validate the SDL before it can reach Lambda. Imported by build.mjs,
// so a broken schema fails the build; also runnable on its own.
//
// `tsc --noEmit` cannot catch a malformed schema: typeDefs is a template literal,
// so to TypeScript it is just a string, and the first thing that ever parses it is
// graphql-yoga at cold start. A bad schema therefore type-checks, bundles,
// deploys, and then every request returns "Internal Server Error" with the reason
// visible only in CloudWatch. That happened - two consecutive block strings in
// front of a type, which is invalid SDL - and it took the live proxy down until
// the logs were read.
import { buildSchema } from 'graphql';
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const temp = resolve(root, 'dist/.schema-check.mjs');

await build({
  entryPoints: [resolve(root, 'src/schema.ts')],
  outfile: temp,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});

// Cache-bust so a rebuild in the same process sees the new file.
const { typeDefs } = await import(`${pathToFileURL(temp).href}?${Date.now()}`);
await rm(temp, { force: true });

try {
  const schema = buildSchema(typeDefs);
  const fields = Object.keys(schema.getQueryType()?.getFields() ?? {});
  const types = Object.keys(schema.getTypeMap()).filter((name) => !name.startsWith('__'));
  console.info(
    `[schema] valid: ${fields.length} queries, ${types.length} types (${fields.join(', ')})`
  );
} catch (error) {
  console.error('[schema] INVALID - this would fail every request at cold start:\n');
  console.error(error.message);
  process.exit(1);
}
