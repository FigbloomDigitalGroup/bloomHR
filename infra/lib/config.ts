// Settings for the Figbloom AWS account. Change these through a PR, then run `npm run diff` and `cdk deploy`.

export const ACCOUNT_ID = '852845752791';

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
}

export const ACCOUNT_SETTINGS: AccountSettings = {
  alertEmails: ['aws-root@figbloom.org'],
  monthlyBudgetUsd: 300,
  anomalyThresholdUsd: 20,
  logArchiveAfterDays: 90,
  logRetentionDays: 7 * 365,
};

export type EnvironmentName = 'staging' | 'production';
