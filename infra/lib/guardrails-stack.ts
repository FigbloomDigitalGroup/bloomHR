import { LegacyStackSynthesizer, Stack, type StackProps } from 'aws-cdk-lib';
import * as organizations from 'aws-cdk-lib/aws-organizations';
import type { Construct } from 'constructs';

export interface GuardrailsStackProps extends Omit<StackProps, 'synthesizer'> {
  // The member accounts the guardrails apply to. Never the management account (SCPs don't apply there anyway).
  stagingAccountId: string;
  productionAccountId: string;
}

export const GUARDRAILS_POLICY_NAME = 'figbloom-guardrails';

// Who the guardrails don't apply to: Mike's AdministratorAccess sign-in (Identity Center role) and the role
// Organizations created in each member account for the management account to step in. Identity Center roles live under
// /aws-reserved/sso.amazonaws.com/<Region>/ (no Region segment when Identity Center is in us-east-1), so the `*` before
// the name covers both. Nobody else can put a fake "AWSReservedSSO_AdministratorAccess_" role under that path: creating
// roles there is denied below.
export const EXEMPT_PRINCIPALS = [
  'arn:aws:iam::*:role/aws-reserved/sso.amazonaws.com/*AWSReservedSSO_AdministratorAccess_*',
  'arn:aws:iam::*:role/OrganizationAccountAccessRole',
];

// The roles Identity Center creates for each permission set in each account
export const IDENTITY_CENTER_ROLES = 'arn:aws:iam::*:role/aws-reserved/sso.amazonaws.com/*';

const deny = (Sid: string, Action: string[], Resource: string | string[] = '*') => ({
  Sid,
  Effect: 'Deny',
  Action,
  Resource,
  Condition: { ArnNotLike: { 'aws:PrincipalArn': EXEMPT_PRINCIPALS } },
});

// The service control policy. SCPs never grant anything: these are denies on top of whatever IAM allows, and they apply
// to every user and role in the account (its root user too), including the CloudFormation execution role a `cdk deploy`
// uses. They don't apply to service-linked roles, so Identity Center (AWSServiceRoleForSSO) can still create, update and
// delete its own roles when permission sets or assignments change.
export const GUARDRAILS_POLICY = {
  Version: '2012-10-17',
  Statement: [
    // 1. Nobody gets long-lived credentials: no IAM users, passwords, access keys or other per-user keys.
    deny('NoLongLivedCredentials', [
      'iam:CreateUser',
      'iam:CreateAccessKey',
      'iam:CreateLoginProfile',
      'iam:UpdateLoginProfile',
      'iam:CreateServiceSpecificCredential',
      'iam:UploadSSHPublicKey',
      'iam:UploadSigningCertificate',
    ]),
    // 2. Identity Center's roles are Identity Center's: nobody else changes what they can do or who can assume them.
    deny(
      'ProtectIdentityCenterRoles',
      [
        'iam:CreateRole',
        'iam:DeleteRole',
        'iam:UpdateRole',
        'iam:UpdateRoleDescription',
        'iam:UpdateAssumeRolePolicy',
        'iam:AttachRolePolicy',
        'iam:DetachRolePolicy',
        'iam:PutRolePolicy',
        'iam:DeleteRolePolicy',
        'iam:PutRolePermissionsBoundary',
        'iam:DeleteRolePermissionsBoundary',
        'iam:TagRole',
        'iam:UntagRole',
      ],
      IDENTITY_CENTER_ROLES,
    ),
    // 3. The audit trail and threat detection stay on.
    deny('KeepAuditOn', [
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
      'guardduty:DisassociateMembers',
    ]),
    // 4. Accounts stay in the organization (and so under these guardrails).
    deny('StayInOrganization', ['organizations:LeaveOrganization']),
  ],
};

// AWS Organizations guardrails for the member accounts (staging and production): one service control policy,
// figbloom-guardrails, attached to those two accounts. Not to the root (that would include the management account, where
// SCPs do nothing, and any account added later without review) and not to the management account.
//
// Organizations policies can only be created from the management account. CloudFormation supports AWS::Organizations
// resources in every commercial Region, so this stack lives in the main Region with the rest of the app. Like
// FigbloomAccess it has no assets and uses the LegacyStackSynthesizer: `cdk deploy` creates it with the caller's own
// (administrator) credentials, so the change is made, and logged, as that person.
//
// Before the first deploy, the SCP policy type has to be enabled on the organization root once (not a CloudFormation
// resource): see "Organization guardrails" in the README.
export class GuardrailsStack extends Stack {
  constructor(scope: Construct, id: string, props: GuardrailsStackProps) {
    super(scope, id, { ...props, synthesizer: new LegacyStackSynthesizer() });
    const targetIds = [props.stagingAccountId, props.productionAccountId];
    for (const target of targetIds) {
      if (!/^\d{12}$/.test(target)) throw new Error(`Guardrails target must be a member account ID, got ${target}`);
      if (target === this.account) throw new Error('Guardrails must not target the management account');
    }

    new organizations.CfnPolicy(this, 'GuardrailsPolicy', {
      name: GUARDRAILS_POLICY_NAME,
      description:
        'Figbloom member account guardrails - no IAM users or access keys, Identity Center roles untouched, CloudTrail and GuardDuty stay on, no leaving the organization',
      type: 'SERVICE_CONTROL_POLICY',
      content: GUARDRAILS_POLICY,
      targetIds,
    });
  }
}
