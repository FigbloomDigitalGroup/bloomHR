import { App, Tags } from 'aws-cdk-lib';
import { AccountSecurityStack } from '../lib/account-security-stack.js';
import { ACCOUNT_ID, ACCOUNT_SETTINGS, APP_HOST, REGION } from '../lib/config.js';
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
