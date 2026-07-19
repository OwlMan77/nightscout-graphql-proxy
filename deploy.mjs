// Deploy the proxy. Two modes:
//   node deploy.mjs              -> rebuild + `terraform apply` (ROTATES the x-api-key) + print key
//   node deploy.mjs --no-rotate  -> rebuild + `aws lambda update-function-code` only (key UNCHANGED)
//
// --no-rotate does a code-only push that never touches Terraform's random_password,
// so the current key keeps working — useful for rapid code iteration without having to
// re-copy a new key into your client / MCP config each time. (Terraform's view of the
// deployed code goes briefly stale; the next full `npm run deploy` reconciles and rotates.)
import { execSync } from 'node:child_process';

const FUNCTION = 'nightscout-graphql-proxy';
const REGION = 'us-east-1'; // keep in sync with infra/terraform.tfvars aws_region
const noRotate = process.argv.includes('--no-rotate');

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

// Always rebuild the bundle first.
run('node build.mjs');

if (noRotate) {
  console.info('\n[deploy] --no-rotate: pushing code only; x-api-key is unchanged.');
  run(
    `aws lambda update-function-code --function-name ${FUNCTION} --region ${REGION} ` +
      `--zip-file fileb://dist/function.zip --output text --query LastUpdateStatus`
  );
  run(`aws lambda wait function-updated --function-name ${FUNCTION} --region ${REGION}`);
  console.info('[deploy] done. Current key unchanged (run `npm run key` to view it).');
} else {
  run('terraform -chdir=infra apply -auto-approve');
  console.info('\n--- current x-api-key: ---');
  run('terraform -chdir=infra output -raw proxy_api_key');
}
