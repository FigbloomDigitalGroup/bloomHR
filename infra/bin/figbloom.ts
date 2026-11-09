import { App, Tags } from 'aws-cdk-lib';
import { AccessStack } from '../lib/access-stack.js';
import { AccountSecurityStack } from '../lib/account-security-stack.js';
import {
  ACCOUNT_ID,
  ACCOUNT_SETTINGS,
  APP_HOST,
  IDENTITY_CENTER_INSTANCE_ARN,
  IDENTITY_CENTER_REGION,
  IDENTITY_STORE_ID,
  PRODUCTION_ACCOUNT_ID,
  REGION,
  STAGING_ACCOUNT_ID,
} from '../lib/config.js';
import { EnvironmentStack } from '../lib/environment-stack.js';
import { ScannerRelayStack } from '../lib/scanner-relay-stack.js';

const app = new App();
const env = { account: ACCOUNT_ID, region: REGION };

Tags.of(app).add('Project', 'figbloom');
Tags.of(app).add('ManagedBy', 'cdk');

new AccountSecurityStack(app, 'FigbloomAccountSecurity', {
  env,
  description: 'Figbloom account guard rails - CloudTrail, GuardDuty, budget and cost anomaly alerts',
  terminationProtection: true,
  settings: ACCOUNT_SETTINGS,
});

new EnvironmentStack(app, 'FigbloomStaging', {
  env,
  description: 'Figbloom staging (test) environment',
  environmentName: 'staging',
});

new EnvironmentStack(app, 'FigbloomProduction', {
  env,
  description: 'Figbloom production environment',
  environmentName: 'production',
});

new ScannerRelayStack(app, 'FigbloomScannerRelay', {
  env,
  description: 'Figbloom scanner relay - door scanners on office networks send punches over HTTP, forwarded to the app over HTTPS',
  appHost: APP_HOST,
});

// Developer sign-in (IAM Identity Center). Has to be in Identity Center's home Region, eu-north-1, so it has its own env.
new AccessStack(app, 'FigbloomAccess', {
  env: { account: ACCOUNT_ID, region: IDENTITY_CENTER_REGION },
  description: 'Figbloom developer access - Identity Center permission sets, groups and account assignments',
  terminationProtection: true,
  instanceArn: IDENTITY_CENTER_INSTANCE_ARN,
  identityStoreId: IDENTITY_STORE_ID,
  stagingAccountId: STAGING_ACCOUNT_ID,
  productionAccountId: PRODUCTION_ACCOUNT_ID,
});
