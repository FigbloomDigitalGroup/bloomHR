// Settings for the Figbloom AWS account. Change these through a PR, then run `npm run diff` and `cdk deploy`.

export const ACCOUNT_ID = '852845752791';
// The AWS Organization this (management) account runs. Its trail covers every account in it: staging, prod, ...
export const ORGANIZATION_ID = 'o-7n7zn7ftfn';

// eu-west-1 (Ireland) keeps data in the EU, which is what the ODPC registration says.
export const REGION = 'eu-west-1';

export interface AccountSettings {
  // Everyone here gets budget, cost anomaly and GuardDuty alerts by email (AWS sends each one a confirmation link first).
  alertEmails: string[];
  // Monthly budget in USD. Emails go out at 50%, 80% and 100% of actual spend, and when the forecast passes 100%.
  monthlyBudgetUsd: number;
  // A cost anomaly email is sent when unusual spend on a service is at least this many USD above normal.
  anomalyThresholdUsd: number;
  // CloudTrail logs move to cheaper Glacier storage after this many days, and are deleted after logRetentionDays.
  logArchiveAfterDays: number;
  logRetentionDays: number;
  // An account can have only one per-service anomaly monitor, and AWS creates "Default-Services-Monitor" by itself when
  // Cost Explorer is first turned on. Its ARN here: the alerts subscribe to it instead of creating a second one (which
  // AWS refuses). Leave it out in an account without one.
  serviceAnomalyMonitorArn?: string;
}

export const ACCOUNT_SETTINGS: AccountSettings = {
  alertEmails: ['aws-root@figbloom.org'],
  monthlyBudgetUsd: 300,
  anomalyThresholdUsd: 20,
  logArchiveAfterDays: 90,
  logRetentionDays: 7 * 365,
  // AWS's Default-Services-Monitor in this account (`aws ce get-anomaly-monitors --region us-east-1`)
  serviceAnomalyMonitorArn: 'arn:aws:ce::852845752791:anomalymonitor/fb7de741-0867-4ae9-be18-9778d6568964',
};

export type EnvironmentName = 'staging' | 'production';

// The app door scanners send punches to (its /iclock/* receiver). The scanner relay forwards to it over HTTPS. Use the
// app's own domain, not bloom-hr-phi.vercel.app: if that address ever redirects, CloudFront won't follow it.
export const APP_HOST = 'hr.figbloom.org';

// --- Developer access (IAM Identity Center). Lives in the management account, in Identity Center's home Region. ---
// Identity Center can only be managed from its home Region, which is eu-north-1 (not REGION above).
export const IDENTITY_CENTER_REGION = 'eu-north-1';
export const IDENTITY_CENTER_INSTANCE_ARN = 'arn:aws:sso:::instance/ssoins-650868325a7f4fe2';
export const IDENTITY_STORE_ID = 'd-c3676f2769';
// The sign-in page developers use with `aws configure sso`
export const SSO_START_URL = 'https://d-c3676f2769.awsapps.com/start';
// The organization's workload accounts the developer groups get access to
export const STAGING_ACCOUNT_ID = '374254524440';
export const PRODUCTION_ACCOUNT_ID = '304550796505';
