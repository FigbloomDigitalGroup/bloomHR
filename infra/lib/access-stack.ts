import { LegacyStackSynthesizer, Stack, type StackProps } from 'aws-cdk-lib';
import * as identitystore from 'aws-cdk-lib/aws-identitystore';
import * as sso from 'aws-cdk-lib/aws-sso';
import type { Construct } from 'constructs';

export interface AccessStackProps extends Omit<StackProps, 'synthesizer'> {
  // IAM Identity Center instance and its identity store (the user directory)
  instanceArn: string;
  identityStoreId: string;
  stagingAccountId: string;
  productionAccountId: string;
}

// Group names. scripts/add-developers-to-groups.ps1 looks the groups up by these names: keep the two in step.
export const GROUPS = {
  developers: 'figbloom-developers',
  prodViewers: 'figbloom-prod-viewers',
  prodDeployers: 'figbloom-prod-deployers',
} as const;

// Permission set names: the role names developers pick when they run `aws configure sso`
export const PERMISSION_SETS = {
  developer: 'Developer',
  viewOnly: 'ViewOnly',
  deployer: 'Deployer',
} as const;

const POWER_USER = 'arn:aws:iam::aws:policy/PowerUserAccess';
const VIEW_ONLY = 'arn:aws:iam::aws:policy/job-function/ViewOnlyAccess';

// PowerUserAccess already leaves out IAM (no users, roles, access keys or policies), Organizations and account settings.
// These close what it still allows that the owner ruled out: billing and payments, and setting up a second Identity Center
// (an "account instance") inside a member account, which would be a way round this stack.
const NO_BILLING_OR_IDENTITY_ADMIN = {
  Sid: 'NoBillingOrIdentityAdmin',
  Effect: 'Deny',
  Action: [
    'aws-portal:*',
    'billing:*',
    'payments:*',
    'tax:*',
    'invoicing:*',
    'purchase-orders:*',
    'cur:*',
    'consolidatedbilling:*',
    'freetier:*',
    'sso:*',
    'sso-directory:*',
    'identitystore:*',
    'identitystore-auth:*',
  ],
  Resource: '*',
};

// Production viewers can see what runs and read its logs, metrics, alarms and traces. These are what they need on top of
// ViewOnlyAccess (which lists and describes resources but doesn't read log events or run Logs Insights queries).
const READ_LOGS_METRICS_TRACES = {
  Sid: 'ReadLogsMetricsTraces',
  Effect: 'Allow',
  Action: [
    'logs:DescribeLogGroups',
    'logs:DescribeLogStreams',
    'logs:DescribeQueries',
    'logs:DescribeQueryDefinitions',
    'logs:GetLogGroupFields',
    'logs:GetLogEvents',
    'logs:FilterLogEvents',
    'logs:StartQuery',
    'logs:GetQueryResults',
    'logs:StopQuery',
    'logs:StartLiveTail',
    'logs:StopLiveTail',
    'cloudwatch:Describe*',
    'cloudwatch:Get*',
    'cloudwatch:List*',
    'xray:BatchGet*',
    'xray:Get*',
    'xray:List*',
    'cloudformation:DescribeStacks',
    'cloudformation:DescribeStackEvents',
    'cloudformation:DescribeStackResource',
    'cloudformation:DescribeStackResources',
    'cloudformation:ListStacks',
    'cloudformation:ListStackResources',
  ],
  Resource: '*',
};

// ...and never the data or secrets behind them. A Deny always wins, whatever ViewOnlyAccess grants now or later.
export const VIEWER_DENIED_ACTIONS = [
  // files in S3 (they can still see buckets and object names)
  's3:GetObject',
  's3:GetObjectVersion',
  's3:GetObjectAttributes',
  's3:GetObjectTorrent',
  // secrets and parameters
  'secretsmanager:GetSecretValue',
  'secretsmanager:BatchGetSecretValue',
  'ssm:GetParameter*',
  // getting onto a server or running commands on it
  'ssm:StartSession',
  'ssm:ResumeSession',
  'ssm:SendCommand',
  'ssm-guiconnect:*',
  'ec2-instance-connect:*',
  'ec2:GetPasswordData',
  'ecs:ExecuteCommand',
  // decrypting
  'kms:Decrypt',
  'kms:ReEncrypt*',
  'kms:GenerateDataKey*',
  // databases
  'rds-db:connect',
  'rds-data:*',
  'rds:DownloadDBLogFilePortion',
  'rds:DownloadCompleteDBLogFile',
  'dynamodb:GetItem',
  'dynamodb:BatchGetItem',
  'dynamodb:Query',
  'dynamodb:Scan',
  'dynamodb:PartiQLSelect',
  'dynamodb:ExecuteStatement',
  'dynamodb:BatchExecuteStatement',
  'dynamodb:GetRecords',
  'dynamodb:ExportTableToPointInTime',
  // running code
  'lambda:InvokeFunction',
  'lambda:InvokeFunctionUrl',
  'lambda:InvokeAsync',
  // people's accounts in Cognito user pools
  'cognito-idp:AdminGetUser',
  'cognito-idp:ListUsers',
  'cognito-idp:ListUsersInGroup',
  'cognito-idp:AdminListGroupsForUser',
  'cognito-idp:AdminListDevices',
  'cognito-idp:AdminGetDevice',
  'cognito-idp:AdminListUserAuthEvents',
  // messages in queues and streams, container images
  'sqs:ReceiveMessage',
  'kinesis:GetRecords',
  'ecr:BatchGetImage',
  'ecr:GetDownloadUrlForLayer',
  // query results
  'athena:GetQueryResults',
];

// Developer access to Figbloom's AWS accounts, through IAM Identity Center (single sign-on, temporary credentials only:
// nobody gets an IAM user or access key). Three permission sets, three groups, and which group gets which set in which
// account. People are added to groups by scripts/add-developers-to-groups.ps1 after they are created in the console.
//
// It must live in the organization's management account, in Identity Center's home Region (eu-north-1). That Region
// isn't CDK-bootstrapped and this stack has no assets, so it uses the LegacyStackSynthesizer: `cdk deploy` creates it
// with the caller's own credentials (no bootstrap roles to assume) and sends the small template to CloudFormation
// directly (no asset bucket), so no CDKToolkit stack is needed there. (BootstraplessSynthesizer would still try to assume
// cdk-hnb659fds-deploy-role-...-eu-north-1, which doesn't exist.) Adding an asset (a Lambda, a file) would need a bootstrap.
export class AccessStack extends Stack {
  constructor(scope: Construct, id: string, props: AccessStackProps) {
    super(scope, id, { ...props, synthesizer: new LegacyStackSynthesizer() });
    const { instanceArn, identityStoreId, stagingAccountId, productionAccountId } = props;

    // --- Permission sets (what you can do once signed in to an account) ---
    // Developer and Deployer are the same power: everything except IAM, Organizations, account settings and billing.
    // `cdk deploy` works with it: the CLI only calls sts:AssumeRole on the account's cdk-hnb659fds-* bootstrap roles
    // (allowed, since PowerUserAccess allows everything outside IAM), and those roles do the rest. No iam:PassRole needed.
    const powerUser = (name: string, description: string, sessionDuration: string) =>
      new sso.CfnPermissionSet(this, `${name}PermissionSet`, {
        instanceArn,
        name,
        description,
        sessionDuration,
        managedPolicies: [POWER_USER],
        inlinePolicy: { Version: '2012-10-17', Statement: [NO_BILLING_OR_IDENTITY_ADMIN] },
      });

    const developer = powerUser(
      PERMISSION_SETS.developer,
      'Figbloom staging developer - deploy and run anything (CDK, servers, Lambda, databases, logs). No IAM, billing or organization access.',
      'PT8H',
    );
    const deployer = powerUser(
      PERMISSION_SETS.deployer,
      'Figbloom production deployer - same as Developer, for production. No IAM, billing or organization access.',
      'PT4H',
    );
    const viewOnly = new sso.CfnPermissionSet(this, 'ViewOnlyPermissionSet', {
      instanceArn,
      name: PERMISSION_SETS.viewOnly,
      description:
        'Figbloom production view-only - see resources, logs, metrics, alarms, traces and stack events. Cannot read data or secrets.',
      sessionDuration: 'PT8H',
      managedPolicies: [VIEW_ONLY],
      inlinePolicy: {
        Version: '2012-10-17',
        Statement: [
          READ_LOGS_METRICS_TRACES,
          { Sid: 'NoDataOrSecrets', Effect: 'Deny', Action: VIEWER_DENIED_ACTIONS, Resource: '*' },
          NO_BILLING_OR_IDENTITY_ADMIN,
        ],
      },
    });

    // --- Groups (who). Members are added by the script, not here: the users are created in the console first. ---
    const group = (key: keyof typeof GROUPS, description: string) =>
      new identitystore.CfnGroup(this, `${key[0].toUpperCase()}${key.slice(1)}Group`, {
        identityStoreId,
        displayName: GROUPS[key],
        description,
      });
    const developers = group('developers', 'Figbloom developers - Developer access to staging');
    const prodViewers = group('prodViewers', 'Figbloom production viewers - ViewOnly access to production');
    const prodDeployers = group('prodDeployers', 'Figbloom production deployers - Deployer access to production');

    // --- Assignments (which group gets which permission set, in which account) ---
    const assign = (id: string, who: identitystore.CfnGroup, what: sso.CfnPermissionSet, accountId: string) =>
      new sso.CfnAssignment(this, id, {
        instanceArn,
        permissionSetArn: what.attrPermissionSetArn,
        principalType: 'GROUP',
        principalId: who.attrGroupId,
        targetType: 'AWS_ACCOUNT',
        targetId: accountId,
      });
    assign('DevelopersInStaging', developers, developer, stagingAccountId);
    assign('ProdViewersInProduction', prodViewers, viewOnly, productionAccountId);
    assign('ProdDeployersInProduction', prodDeployers, deployer, productionAccountId);
  }
}
