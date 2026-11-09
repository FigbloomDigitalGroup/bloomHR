import { App, LegacyStackSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AccessStack, GROUPS, PERMISSION_SETS } from '../lib/access-stack.js';
import { AccountSecurityStack } from '../lib/account-security-stack.js';
import type { AccountSettings } from '../lib/config.js';
import { EnvironmentStack } from '../lib/environment-stack.js';
import {
  EXEMPT_PRINCIPALS,
  GUARDRAILS_POLICY,
  GUARDRAILS_POLICY_NAME,
  GuardrailsStack,
  IDENTITY_CENTER_ROLES,
} from '../lib/guardrails-stack.js';
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
  it("lets the organization trail write every account's logs, and only from this account's trails", () => {
    const t = securityTemplate();
    t.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'CloudTrailOrganizationWrite',
            Action: 's3:PutObject',
            Condition: Match.objectLike({ ArnLike: { 'aws:SourceArn': Match.anyValue() } }),
          }),
        ]),
      },
    });
  });

  it('logs every Region to a private, retained, validated trail', () => {
    const t = securityTemplate();
    t.hasResourceProperties('AWS::CloudTrail::Trail', {
      IsMultiRegionTrail: true,
      IsOrganizationTrail: true,
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

describe('AccessStack', () => {
  const staging = '111111111111';
  const production = '222222222222';
  const stack = new AccessStack(new App(), 'Access', {
    env: { account: '123456789012', region: 'eu-north-1' },
    instanceArn: 'arn:aws:sso:::instance/ssoins-0000000000000000',
    identityStoreId: 'd-0000000000',
    stagingAccountId: staging,
    productionAccountId: production,
  });
  const t = Template.fromStack(stack);

  type Statement = { Sid: string; Effect: string; Action: string | string[] };
  const permissionSet = (name: string) => {
    const found = Object.entries(t.findResources('AWS::SSO::PermissionSet', { Properties: { Name: name } }));
    expect(found).toHaveLength(1);
    const [logicalId, resource] = found[0];
    return { logicalId, props: resource.Properties, statements: resource.Properties.InlinePolicy.Statement as Statement[] };
  };
  const actions = (s: Statement) => (Array.isArray(s.Action) ? s.Action : [s.Action]);
  const groupId = (name: string) => Object.keys(t.findResources('AWS::IdentityStore::Group', { Properties: { DisplayName: name } }))[0];

  it('gives Developer (staging, 8h) and Deployer (production, 4h) PowerUserAccess, minus billing and Identity Center', () => {
    for (const [name, hours] of [[PERMISSION_SETS.developer, 8], [PERMISSION_SETS.deployer, 4]] as const) {
      const { props, statements } = permissionSet(name);
      expect(props.ManagedPolicies).toEqual(['arn:aws:iam::aws:policy/PowerUserAccess']);
      expect(props.SessionDuration).toBe(`PT${hours}H`);
      expect(statements.filter((s) => s.Effect === 'Allow')).toEqual([]);
      const deny = statements.find((s) => s.Sid === 'NoBillingOrIdentityAdmin')!;
      expect(deny.Effect).toBe('Deny');
      expect(actions(deny)).toEqual(expect.arrayContaining(['aws-portal:*', 'billing:*', 'payments:*', 'sso:*', 'identitystore:*']));
    }
  });

  it('gives ViewOnly (production, 8h) ViewOnlyAccess plus logs, metrics and traces, and denies data and secrets', () => {
    const { props, statements } = permissionSet(PERMISSION_SETS.viewOnly);
    expect(props.ManagedPolicies).toEqual(['arn:aws:iam::aws:policy/job-function/ViewOnlyAccess']);
    expect(props.SessionDuration).toBe('PT8H');
    const allow = statements.find((s) => s.Sid === 'ReadLogsMetricsTraces')!;
    expect(allow.Effect).toBe('Allow');
    expect(actions(allow)).toEqual(
      expect.arrayContaining([
        'logs:FilterLogEvents',
        'logs:GetLogEvents',
        'logs:StartQuery',
        'logs:GetQueryResults',
        'logs:StopQuery',
        'logs:DescribeLogStreams',
        'cloudwatch:Get*',
        'cloudwatch:List*',
        'cloudwatch:Describe*',
        'xray:Get*',
        'cloudformation:DescribeStackEvents',
      ]),
    );
    // nothing the allow grants reads data
    expect(actions(allow).some((a) => /^(s3|secretsmanager|ssm|kms|dynamodb|rds-data|lambda):/.test(a))).toBe(false);
    const deny = statements.find((s) => s.Sid === 'NoDataOrSecrets')!;
    expect(deny.Effect).toBe('Deny');
    expect(actions(deny)).toEqual(
      expect.arrayContaining([
        's3:GetObject',
        's3:GetObjectVersion',
        'secretsmanager:GetSecretValue',
        'ssm:GetParameter*',
        'ssm:StartSession',
        'ssm:SendCommand',
        'kms:Decrypt',
        'rds-db:connect',
        'rds-data:*',
        'lambda:InvokeFunction',
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:BatchGetItem',
        'cognito-idp:AdminGetUser',
        'cognito-idp:ListUsers',
      ]),
    );
    expect(statements.some((s) => s.Sid === 'NoBillingOrIdentityAdmin' && s.Effect === 'Deny')).toBe(true);
  });

  it('creates the three groups, with no members (the script adds people)', () => {
    t.resourceCountIs('AWS::IdentityStore::Group', 3);
    for (const name of Object.values(GROUPS)) {
      t.hasResourceProperties('AWS::IdentityStore::Group', { DisplayName: name, IdentityStoreId: 'd-0000000000' });
    }
    t.resourceCountIs('AWS::IdentityStore::GroupMembership', 0);
  });

  it('assigns developers to staging, viewers and deployers to production, and nothing else', () => {
    t.resourceCountIs('AWS::SSO::Assignment', 3);
    const expected = [
      [GROUPS.developers, PERMISSION_SETS.developer, staging],
      [GROUPS.prodViewers, PERMISSION_SETS.viewOnly, production],
      [GROUPS.prodDeployers, PERMISSION_SETS.deployer, production],
    ] as const;
    for (const [group, set, account] of expected) {
      t.hasResourceProperties('AWS::SSO::Assignment', {
        PrincipalType: 'GROUP',
        PrincipalId: { 'Fn::GetAtt': [groupId(group), 'GroupId'] },
        PermissionSetArn: { 'Fn::GetAtt': [permissionSet(set).logicalId, 'PermissionSetArn'] },
        TargetType: 'AWS_ACCOUNT',
        TargetId: account,
      });
    }
  });

  it('creates no IAM users, access keys or roles, and grants no IAM actions', () => {
    for (const type of ['AWS::IAM::User', 'AWS::IAM::AccessKey', 'AWS::IAM::Role', 'AWS::IAM::Policy']) t.resourceCountIs(type, 0);
    for (const set of Object.values(PERMISSION_SETS)) {
      const allowed = permissionSet(set).statements.filter((s) => s.Effect === 'Allow').flatMap(actions);
      expect(allowed.some((a) => a.startsWith('iam:') || a === '*')).toBe(false);
    }
  });

  it('needs no CDK bootstrap in its Region, and uses no em dashes in names or descriptions', () => {
    // deploys with the caller's own credentials: no cdk-hnb659fds-* roles to assume, no asset bucket
    expect(stack.synthesizer).toBeInstanceOf(LegacyStackSynthesizer);
    const json = t.toJSON();
    expect(json.Parameters?.BootstrapVersion).toBeUndefined();
    expect(json.Rules?.CheckBootstrapVersion).toBeUndefined();
    expect(JSON.stringify(json)).not.toMatch(/—|–/);
    // small enough for CloudFormation to take inline, with no asset bucket to upload it to
    expect(JSON.stringify(json).length).toBeLessThan(51_200);
  });
});

describe('GuardrailsStack', () => {
  const management = '123456789012';
  const staging = '111111111111';
  const production = '222222222222';
  const newStack = (stagingAccountId = staging, productionAccountId = production) =>
    new GuardrailsStack(new App(), 'Guardrails', {
      env: { account: management, region: 'eu-west-1' },
      stagingAccountId,
      productionAccountId,
    });
  const stack = newStack();
  const t = Template.fromStack(stack);

  type Statement = { Sid: string; Effect: string; Action: string[]; Resource: string | string[]; Condition: unknown };
  const policies = Object.values(t.findResources('AWS::Organizations::Policy'));
  const content = policies[0]?.Properties.Content as { Version: string; Statement: Statement[] };
  const statement = (sid: string) => {
    const found = content.Statement.find((s) => s.Sid === sid);
    expect(found, sid).toBeDefined();
    return found!;
  };

  it('creates one service control policy, figbloom-guardrails, with the policy as a JSON object', () => {
    expect(policies).toHaveLength(1);
    expect(policies[0].Properties.Type).toBe('SERVICE_CONTROL_POLICY');
    expect(policies[0].Properties.Name).toBe(GUARDRAILS_POLICY_NAME);
    expect(content).toEqual(GUARDRAILS_POLICY);
  });

  it('attaches it to the staging and production accounts only: not the root, an OU or the management account', () => {
    const targets = policies[0].Properties.TargetIds as string[];
    expect([...targets].sort()).toEqual([staging, production].sort());
    expect(targets.some((id) => id.startsWith('r-') || id.startsWith('ou-'))).toBe(false);
    expect(targets).not.toContain(management);
    expect(() => newStack(management)).toThrow(/management account/);
    expect(() => newStack(staging, 'r-h7lc')).toThrow(/member account ID/);
  });

  it('only denies, and exempts only the AdministratorAccess sign-in and OrganizationAccountAccessRole, everywhere', () => {
    expect(content.Statement).toHaveLength(4);
    for (const s of content.Statement) {
      expect(s.Effect).toBe('Deny');
      expect(s.Condition).toEqual({ ArnNotLike: { 'aws:PrincipalArn': EXEMPT_PRINCIPALS } });
    }
    expect(EXEMPT_PRINCIPALS).toEqual([
      'arn:aws:iam::*:role/aws-reserved/sso.amazonaws.com/*AWSReservedSSO_AdministratorAccess_*',
      'arn:aws:iam::*:role/OrganizationAccountAccessRole',
    ]);
    // the exemption matches Identity Center role ARNs with and without a Region segment, and not the other sets
    const arnLike = (pattern: string, arn: string) =>
      new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(arn);
    const exempt = (arn: string) => EXEMPT_PRINCIPALS.some((p) => arnLike(p, arn));
    expect(exempt('arn:aws:iam::111111111111:role/aws-reserved/sso.amazonaws.com/eu-north-1/AWSReservedSSO_AdministratorAccess_0123abcd')).toBe(true);
    expect(exempt('arn:aws:iam::111111111111:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_AdministratorAccess_0123abcd')).toBe(true);
    expect(exempt('arn:aws:iam::111111111111:role/OrganizationAccountAccessRole')).toBe(true);
    for (const set of ['Developer', 'Deployer', 'ViewOnly']) {
      expect(exempt(`arn:aws:iam::111111111111:role/aws-reserved/sso.amazonaws.com/eu-north-1/AWSReservedSSO_${set}_0123abcd`)).toBe(false);
    }
    expect(exempt('arn:aws:iam::111111111111:role/cdk-hnb659fds-cfn-exec-role-111111111111-eu-west-1')).toBe(false);
    expect(exempt('arn:aws:iam::111111111111:root')).toBe(false);
  });

  it('denies creating IAM users, passwords and access keys', () => {
    expect(statement('NoLongLivedCredentials').Action).toEqual(
      expect.arrayContaining(['iam:CreateUser', 'iam:CreateAccessKey', 'iam:CreateLoginProfile', 'iam:UpdateLoginProfile']),
    );
    expect(statement('NoLongLivedCredentials').Resource).toBe('*');
  });

  it("denies changing Identity Center's roles (the service-linked role Identity Center uses is not affected by SCPs)", () => {
    const s = statement('ProtectIdentityCenterRoles');
    expect(s.Resource).toBe(IDENTITY_CENTER_ROLES);
    expect(IDENTITY_CENTER_ROLES).toBe('arn:aws:iam::*:role/aws-reserved/sso.amazonaws.com/*');
    expect(s.Action).toEqual(
      expect.arrayContaining([
        'iam:CreateRole',
        'iam:DeleteRole',
        'iam:UpdateAssumeRolePolicy',
        'iam:AttachRolePolicy',
        'iam:DetachRolePolicy',
        'iam:PutRolePolicy',
        'iam:DeleteRolePolicy',
        'iam:PutRolePermissionsBoundary',
        'iam:DeleteRolePermissionsBoundary',
      ]),
    );
  });

  it('denies turning off CloudTrail and GuardDuty', () => {
    expect(statement('KeepAuditOn').Action).toEqual(
      expect.arrayContaining([
        'cloudtrail:StopLogging',
        'cloudtrail:DeleteTrail',
        'cloudtrail:UpdateTrail',
        'cloudtrail:PutEventSelectors',
        'cloudtrail:PutInsightSelectors',
        'guardduty:DeleteDetector',
        'guardduty:UpdateDetector',
        'guardduty:DisassociateFromMasterAccount',
        'guardduty:DisassociateFromAdministratorAccount',
        'guardduty:StopMonitoringMembers',
        'guardduty:DeleteMembers',
      ]),
    );
  });

  it('denies leaving the organization', () => {
    expect(statement('StayInOrganization').Action).toEqual(['organizations:LeaveOrganization']);
  });

  it('keeps the policy well under the 5,120 character SCP limit, even with whitespace', () => {
    expect(JSON.stringify(GUARDRAILS_POLICY).length).toBeLessThan(4_000);
    expect(JSON.stringify(GUARDRAILS_POLICY, null, 2).length).toBeLessThan(5_120);
  });

  it('needs no CDK bootstrap, and uses no em dashes in names or descriptions', () => {
    expect(stack.synthesizer).toBeInstanceOf(LegacyStackSynthesizer);
    const json = t.toJSON();
    expect(json.Parameters?.BootstrapVersion).toBeUndefined();
    expect(JSON.stringify(json)).not.toMatch(/—|–/);
    expect(policies[0].Properties.Description.length).toBeLessThanOrEqual(512);
  });
});
