import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as ce from 'aws-cdk-lib/aws-ce';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import type { AccountSettings } from './config.js';

export interface AccountSecurityStackProps extends StackProps {
  settings: AccountSettings;
}

// Account-wide guard rails, deployed once (not per environment): an audit log of every AWS action, threat detection,
// and cost alerts. Everything here is kept if the stack is deleted, so the audit trail can't be lost by accident.
export class AccountSecurityStack extends Stack {
  constructor(scope: Construct, id: string, props: AccountSecurityStackProps) {
    super(scope, id, props);
    const { settings } = props;

    if (settings.alertEmails.length === 0) throw new Error('ACCOUNT_SETTINGS.alertEmails is empty: alerts would go nowhere');
    if (settings.monthlyBudgetUsd <= 0) throw new Error('ACCOUNT_SETTINGS.monthlyBudgetUsd must be more than 0');

    // --- Alerts topic (GuardDuty findings) ---
    const alerts = new sns.Topic(this, 'SecurityAlerts', {
      displayName: 'Figbloom AWS security alerts',
      enforceSSL: true,
    });
    for (const email of settings.alertEmails) alerts.addSubscription(new subs.EmailSubscription(email));

    // --- CloudTrail: every API call in every Region, kept in an S3 bucket nobody outside the account can read ---
    const trailBucket = new s3.Bucket(this, 'AuditLogBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          transitions: [
            { storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL, transitionAfter: Duration.days(settings.logArchiveAfterDays) },
          ],
          expiration: Duration.days(settings.logRetentionDays),
          noncurrentVersionExpiration: Duration.days(30),
        },
      ],
    });

    new cloudtrail.Trail(this, 'AuditTrail', {
      bucket: trailBucket,
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
      // A digest file per hour lets us prove the logs weren't edited afterwards
      enableFileValidation: true,
    });

    // --- GuardDuty: watches CloudTrail, DNS and network logs for signs of a break-in. Findings rated high (7+) are emailed ---
    new guardduty.CfnDetector(this, 'ThreatDetector', {
      enable: true,
      findingPublishingFrequency: 'FIFTEEN_MINUTES',
    });

    new events.Rule(this, 'HighSeverityFindings', {
      description: 'Email GuardDuty findings with severity 7 or higher',
      eventPattern: {
        source: ['aws.guardduty'],
        detailType: ['GuardDuty Finding'],
        detail: { severity: [{ numeric: ['>=', 7] }] },
      },
      targets: [new targets.SnsTopic(alerts)],
    });

    // --- Budget: monthly cost limit with early warnings ---
    const budgetSubscribers = settings.alertEmails.map((address) => ({ subscriptionType: 'EMAIL', address }));
    const notify = (threshold: number, notificationType: 'ACTUAL' | 'FORECASTED') => ({
      notification: { comparisonOperator: 'GREATER_THAN', notificationType, threshold, thresholdType: 'PERCENTAGE' },
      subscribers: budgetSubscribers,
    });
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'figbloom-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: settings.monthlyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [notify(50, 'ACTUAL'), notify(80, 'ACTUAL'), notify(100, 'ACTUAL'), notify(100, 'FORECASTED')],
    });

    // --- Cost anomaly detection: catches a sudden spike on one service well before the monthly budget fills up ---
    // (the account's existing per-service monitor when there is one: only one is allowed)
    const monitorArn =
      settings.serviceAnomalyMonitorArn ??
      new ce.CfnAnomalyMonitor(this, 'ServiceSpendMonitor', {
        monitorName: 'figbloom-per-service',
        monitorType: 'DIMENSIONAL',
        monitorDimension: 'SERVICE',
      }).attrMonitorArn;
    new ce.CfnAnomalySubscription(this, 'ServiceSpendAlerts', {
      subscriptionName: 'figbloom-spend-anomalies',
      frequency: 'DAILY',
      monitorArnList: [monitorArn],
      subscribers: settings.alertEmails.map((address) => ({ type: 'EMAIL', address })),
      thresholdExpression: JSON.stringify({
        Dimensions: {
          Key: 'ANOMALY_TOTAL_IMPACT_ABSOLUTE',
          MatchOptions: ['GREATER_THAN_OR_EQUAL'],
          Values: [String(settings.anomalyThresholdUsd)],
        },
      }),
    });
  }
}
