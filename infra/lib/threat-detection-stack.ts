import { Stack, type StackProps } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';

export interface ThreatDetectionStackProps extends StackProps {
  /** who gets an email for each high-severity finding (AWS sends each one a confirmation link first) */
  alertEmails: string[];
}

/**
 * GuardDuty in one workload account (figbloom-staging, figbloom-prod): watches the account's CloudTrail, DNS and
 * network logs for signs of a break-in, and emails findings rated high (7 or more). The management account has its own
 * detector in FigbloomAccountSecurity; GuardDuty only sees the account it runs in, so each account needs one.
 * The figbloom-guardrails SCP stops anyone in these accounts turning it off.
 */
export class ThreatDetectionStack extends Stack {
  constructor(scope: Construct, id: string, props: ThreatDetectionStackProps) {
    super(scope, id, props);
    if (props.alertEmails.length === 0) throw new Error('alertEmails is empty: GuardDuty findings would go nowhere');

    const alerts = new sns.Topic(this, 'SecurityAlerts', {
      displayName: 'Figbloom AWS security alerts',
      enforceSSL: true,
    });
    for (const email of props.alertEmails) alerts.addSubscription(new subs.EmailSubscription(email));

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
  }
}
