# Figbloom AWS infrastructure

AWS CDK app (TypeScript) for account 852845752791 in eu-west-1. This is its own npm package: run commands from `infra/`.

| Stack | What it holds |
| -- | -- |
| `FigbloomAccountSecurity` | Account-wide, deployed once: CloudTrail (all Regions, logs kept 7 years), GuardDuty with emails for high-severity findings, the monthly budget and cost anomaly alerts. Settings are in `lib/config.ts`. |
| `FigbloomStaging` | The test environment. Self-hosted Supabase, the website and the API are added here in later stages. |
| `FigbloomProduction` | The live environment, built by the same code as staging. Has termination protection. |

## Working on it

```sh
cd infra
npm ci
npm test              # checks the stacks without touching AWS
npm run synth         # builds the CloudFormation templates into cdk.out/
aws login --profile figbloom
npm run diff          # shows what a deploy would add, change or delete
npx cdk deploy FigbloomStaging --profile figbloom
```

Always run `npm run diff` and check the output before `cdk deploy`, and deploy staging before production. Sign in as your IAM Identity Center user, never the root user.

## One-time setup (already done once per account)

```sh
npx cdk bootstrap aws://852845752791/eu-west-1 --profile figbloom
```

Cost anomaly alerts need Cost Explorer turned on: open Billing and Cost Management > Cost Explorer in the console once. It can take up to 24 hours before it's ready.
