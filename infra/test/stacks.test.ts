import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AccountSecurityStack } from '../lib/account-security-stack.js';
import type { AccountSettings } from '../lib/config.js';
import { EnvironmentStack } from '../lib/environment-stack.js';
import { RELAY_HEADER, ScannerRelayStack } from '../lib/scanner-relay-stack.js';

const env = { account: '123456789012', region: 'eu-west-1' };
const settings: AccountSettings = {
  alertEmails: ['ops@example.com', 'cto@example.com'],
  monthlyBudgetUsd: 300,
  anomalyThresholdUsd: 20,
  logArchiveAfterDays: 90,
  logRetentionDays: 2555,
};

function securityTemplate(overrides: Partial<AccountSettings> = {}) {
  const stack = new AccountSecurityStack(new App(), 'Security', { env, settings: { ...settings, ...overrides } });
  return Template.fromStack(stack);
}

describe('AccountSecurityStack', () => {
  it('logs every Region to a private, retained, validated trail', () => {
    const t = securityTemplate();
    t.hasResourceProperties('AWS::CloudTrail::Trail', {
      IsMultiRegionTrail: true,
      IncludeGlobalServiceEvents: true,
      EnableLogFileValidation: true,
    });
    t.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        VersioningConfiguration: { Status: 'Enabled' },
      }),
    });
  });

  it('turns GuardDuty on and emails high-severity findings', () => {
    const t = securityTemplate();
    t.hasResourceProperties('AWS::GuardDuty::Detector', { Enable: true });
    t.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({ source: ['aws.guardduty'], detail: { severity: [{ numeric: ['>=', 7] }] } }),
    });
    t.resourceCountIs('AWS::SNS::Subscription', 2);
  });

  it('sets a monthly budget that warns at 50/80/100% and on forecast', () => {
    const t = securityTemplate();
    const budget = Object.values(t.findResources('AWS::Budgets::Budget'))[0];
    expect(budget.Properties.Budget.BudgetLimit).toEqual({ Amount: 300, Unit: 'USD' });
    const thresholds = budget.Properties.NotificationsWithSubscribers.map(
      (n: { Notification: { Threshold: number; NotificationType: string } }) =>
        `${n.Notification.NotificationType}:${n.Notification.Threshold}`,
    );
    expect(thresholds).toEqual(['ACTUAL:50', 'ACTUAL:80', 'ACTUAL:100', 'FORECASTED:100']);
  });

  it('alerts on cost anomalies above the threshold', () => {
    const t = securityTemplate();
    t.hasResourceProperties('AWS::CE::AnomalyMonitor', { MonitorType: 'DIMENSIONAL', MonitorDimension: 'SERVICE' });
    // an account that already has AWS's per-service monitor: the alerts use it, and no second one is created
    const existing = 'arn:aws:ce::123456789012:anomalymonitor/abc';
    const reuse = securityTemplate({ serviceAnomalyMonitorArn: existing });
    reuse.resourceCountIs('AWS::CE::AnomalyMonitor', 0);
    reuse.hasResourceProperties('AWS::CE::AnomalySubscription', { MonitorArnList: [existing] });
    const sub = Object.values(t.findResources('AWS::CE::AnomalySubscription'))[0];
    expect(JSON.parse(sub.Properties.ThresholdExpression).Dimensions.Values).toEqual(['20']);
    expect(sub.Properties.Subscribers).toHaveLength(2);
  });

  it('refuses to build without anyone to alert or without a budget', () => {
    expect(() => securityTemplate({ alertEmails: [] })).toThrow(/alertEmails/);
    expect(() => securityTemplate({ monthlyBudgetUsd: 0 })).toThrow(/monthlyBudgetUsd/);
  });
});

describe('EnvironmentStack', () => {
  it('protects production from deletion but not staging', () => {
    const app = new App();
    const staging = new EnvironmentStack(app, 'Staging', { env, environmentName: 'staging' });
    const production = new EnvironmentStack(app, 'Production', { env, environmentName: 'production' });
    expect(staging.terminationProtection).toBe(false);
    expect(production.terminationProtection).toBe(true);
    Template.fromStack(production).hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/figbloom/production/environment',
      Value: 'production',
    });
  });
});

describe('ScannerRelayStack', () => {
  const t = Template.fromStack(new ScannerRelayStack(new App(), 'Relay', { env, appHost: 'app.example.com' }));

  it('accepts HTTP from scanners without redirecting, forwards over HTTPS only, and caches nothing', () => {
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'allow-all',
          AllowedMethods: Match.arrayWith(['POST']),
          CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
        }),
        Origins: [
          Match.objectLike({
            DomainName: 'app.example.com',
            CustomOriginConfig: Match.objectLike({ OriginProtocolPolicy: 'https-only' }),
            OriginCustomHeaders: [
              // a {{resolve:secretsmanager:...}} reference built around the secret's ARN: resolved by CloudFormation
              Match.objectLike({
                HeaderName: RELAY_HEADER,
                HeaderValue: { 'Fn::Join': ['', Match.arrayWith([Match.stringLikeRegexp('resolve:secretsmanager')])] },
              }),
            ],
          }),
        ],
      }),
    });
  });

  it('lets only /iclock/ through, and passes the scanner IP and query string', () => {
    t.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionCode: Match.stringLikeRegexp("/iclock/"),
    });
    t.hasResourceProperties('AWS::CloudFront::OriginRequestPolicy', {
      OriginRequestPolicyConfig: Match.objectLike({
        QueryStringsConfig: { QueryStringBehavior: 'all' },
        HeadersConfig: { HeaderBehavior: 'whitelist', Headers: Match.arrayWith(['CloudFront-Viewer-Address']) },
      }),
    });
  });

  it('keeps the shared secret in Secrets Manager, generated (never in code)', () => {
    t.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'figbloom/scanner-relay/header-secret',
      GenerateSecretString: Match.objectLike({ PasswordLength: 48 }),
    });
    t.hasOutput('ScannerServerAddress', {});
  });
});
