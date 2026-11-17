# Figbloom AWS infrastructure

AWS CDK app (TypeScript) for account 852845752791 in eu-west-1. This is its own npm package: run commands from `infra/`.

| Stack | What it holds |
| -- | -- |
| `FigbloomAccountSecurity` | Account-wide, deployed once: CloudTrail (all Regions, logs kept 7 years), GuardDuty with emails for high-severity findings, the monthly budget and cost anomaly alerts. Settings are in `lib/config.ts`. |
| `FigbloomStaging` | The test environment. Self-hosted Supabase, the website and the API are added here in later stages. |
| `FigbloomProduction` | The live environment, built by the same code as staging. Has termination protection. |
| `FigbloomScannerRelay` | Relays punches from office door scanners (HTTP) to the app over HTTPS. |
| `FigbloomAccess` | Developer sign-in through IAM Identity Center: permission sets, groups and which group gets what in staging and production. In **eu-north-1** (Identity Center's home Region). See [Developer access](#developer-access). |
| `FigbloomGuardrails` | The `figbloom-guardrails` service control policy (SCP) on the staging and production accounts: no IAM users or access keys, Identity Center's roles left alone, CloudTrail and GuardDuty stay on, no leaving the organization. See [Organization guardrails](#organization-guardrails). |

## Working on it

```sh
cd infra
npm ci
npm test              # checks the stacks without touching AWS
npm run synth         # builds the CloudFormation templates into cdk.out/
aws login --profile figbloom
npm run diff -- --profile figbloom                   # what a deploy would add, change or delete, every stack
npm run diff -- FigbloomStaging --profile figbloom   # or one stack
npx cdk deploy FigbloomStaging --profile figbloom
```

`npm run diff` has no profile built in: pass the one you signed in with after `--` (`figbloom`, `figbloom-mgmt`,
`figbloom-staging`, ...). Always run it and check the output before `cdk deploy`, and deploy staging before production. Sign in as your IAM Identity Center user, never the root user.

## One-time setup (already done once per account)

```sh
npx cdk bootstrap aws://852845752791/eu-west-1 --profile figbloom
```

Cost anomaly alerts need Cost Explorer turned on: open Billing and Cost Management > Cost Explorer in the console once. It can take up to 24 hours before it's ready.

## Developer access

Developers sign in through IAM Identity Center (single sign-on) and get temporary credentials for the staging
(374254524440) or production (304550796505) account. Nobody gets an IAM user or access key. The `FigbloomAccess` stack
(`lib/access-stack.ts`) holds the permission sets, the groups and the assignments; who is in which group is set by
`scripts/add-developers-to-groups.ps1`, because the users are created by hand in the console (so AWS emails each one an
invitation).

| Group | Account | Permission set | Can | Can't |
| -- | -- | -- | -- | -- |
| `figbloom-developers` (Ancel, Morris, Hassan, Given, Joseph) | staging | `Developer`, 8h sessions | Deploy and run anything: `cdk deploy`, servers, Lambda, databases, S3, logs (AWS managed `PowerUserAccess`) | Manage IAM users, roles or policies, Organizations, account settings, billing, Identity Center |
| `figbloom-prod-viewers` (Ancel, Hassan, Morris) | production | `ViewOnly`, 8h sessions | See every resource and its settings, read CloudWatch logs (including Logs Insights and Live Tail), metrics, alarms and dashboards, X-Ray traces, CloudFormation stacks and events (AWS managed `ViewOnlyAccess` plus an inline policy) | Read any data or secrets: S3 objects, Secrets Manager values, SSM parameters, KMS decrypt, database connections and queries (RDS, Data API, DynamoDB), invoking Lambdas, Session Manager / Run Command / Instance Connect / ECS Exec, Cognito user details, queue and stream messages. These are explicit denies, so nothing else can grant them. Also no billing or Identity Center |
| `figbloom-prod-deployers` (Morris) | production | `Deployer`, 4h sessions | The same as `Developer`, in production | The same as `Developer` |

Keep secrets out of Lambda environment variables and CloudFormation parameters: viewers can see resource settings, and
those are settings. Put them in Secrets Manager.

`cdk deploy` works with `Developer` and `Deployer`: the CLI only assumes the account's `cdk-hnb659fds-*` bootstrap roles
(`sts:AssumeRole`, which `PowerUserAccess` allows) and those roles do the rest, so no `iam:PassRole` is needed. Staging
and production each need a `cdk bootstrap` once (by an administrator). Note that the bootstrap roles can create IAM roles
for the app, as any CDK deploy has to: that is how a developer's stack gets its Lambda roles.

### Deploying the stack (administrator, management account)

```sh
npm run diff -- FigbloomAccess --profile figbloom-mgmt
npx cdk deploy FigbloomAccess --profile figbloom-mgmt
```

It needs no `cdk bootstrap` in eu-north-1: it has no assets and deploys with your own credentials (it uses the
`LegacyStackSynthesizer`). Adding an asset to it (a Lambda, a file) would change that.

### Adding a developer (Mike)

1. In the management account, open **IAM Identity Center > Users > Add user**. Username = their email (for example
   `ancel@figbloom.org`), email = the same, first and last name. Choose **Send an email to this user with password setup
   instructions**. Don't add them to a group here. Click through to **Add user**. AWS emails them an invitation, valid for
   7 days.
2. Once the stack is deployed and the users exist, run (needs a signed-in `figbloom-mgmt` profile):

   ```powershell
   cd infra
   aws sso login --profile figbloom-mgmt
   .\scripts\add-developers-to-groups.ps1 -WhatIf   # shows what it would do
   .\scripts\add-developers-to-groups.ps1
   ```

   It finds each person by email or user name, ignoring case (`Hassan` / `Hassan@figbloom.org` matches
   `hassan@figbloom.org`), adds them to their groups, skips anyone already in, and lists each group's members at the end.
   Anyone not created yet shows as "user not created yet": create them and run it again. To change who is in which group,
   edit `$Membership` at the top of the script (removing someone from a group is done in the console).

### Turning on MFA (Mike, once, in the console)

**IAM Identity Center > Settings > Authentication > Multi-factor authentication > Configure**:

- Prompt users for MFA: **Every time they sign in (always-on)**
- Users can authenticate with: **Authenticator apps** (and security keys and built-in authenticators if you like)
- If a user does not yet have a registered MFA device: **Block their sign-in**

With "Block their sign-in", nobody can sign in without an MFA device already registered. New developers can't register
one themselves then: before they first sign in, either switch this to **Require them to register an MFA device at sign
in** (they must add one before they get in, so there is still no sign-in without MFA) until everyone has one, or
register a device for them under **Users > (user) > MFA devices**.

This is an Identity Center setting, not part of the stack.

### Signing in (developers)

After accepting the invitation and setting a password and MFA, set up the AWS CLI once (AWS CLI v2):

```sh
aws configure sso
#   SSO session name:        figbloom
#   SSO start URL:           https://d-c3676f2769.awsapps.com/start
#   SSO region:              eu-north-1
#   SSO registration scopes: (press Enter)
# a browser opens to approve; then pick the account and role, and set
#   CLI default client Region: eu-west-1
#   CLI profile name:          see below
```

Run it once per account and role you have, with these profile names:

| Profile | Account | Role | Who |
| -- | -- | -- | -- |
| `figbloom-staging` | figbloom-staging (374254524440) | `Developer` | all developers |
| `figbloom-prod-readonly` | figbloom-prod (304550796505) | `ViewOnly` | Ancel, Hassan, Morris |
| `figbloom-prod` | figbloom-prod (304550796505) | `Deployer` | Morris |

Then each day (sessions last 8 hours, 4 for `Deployer`):

```sh
aws sso login --sso-session figbloom
aws sts get-caller-identity --profile figbloom-staging
npx cdk deploy FigbloomStaging --profile figbloom-staging
```

The web console is at the same start URL.

## Organization guardrails

`FigbloomGuardrails` (`lib/guardrails-stack.ts`) holds one AWS Organizations service control policy (SCP),
`figbloom-guardrails`, attached to the staging (374254524440) and production (304550796505) accounts. Not to the
organization root and not to the management account (SCPs never apply to the management account anyway). An SCP grants
nothing: it is a list of denies that no IAM policy in those accounts can override, and it applies to every user and role
there, the account root user and the CDK deployment roles included.

| Denied | Why |
| -- | -- |
| Creating IAM users, console passwords, access keys, service-specific credentials, SSH keys and signing certificates | Nobody gets long-lived credentials. A developer could otherwise create an IAM user and access key through a `cdk deploy`, because CDK's CloudFormation execution role is an administrator. |
| Creating, deleting or changing the roles under `/aws-reserved/sso.amazonaws.com/` (policies, trust policy, boundary, tags) | Those are Identity Center's roles (`AWSReservedSSO_*`). Identity Center itself still manages them: it uses a service-linked role, and SCPs don't apply to service-linked roles. |
| Stopping, deleting or changing CloudTrail trails and event selectors; deleting, pausing or disconnecting GuardDuty | The audit trail and threat detection stay on. (AWS Config isn't used, so it isn't covered.) |
| `organizations:LeaveOrganization` | An account can't step out from under these guardrails. |

Everything is denied for everyone except two roles: the `AdministratorAccess` Identity Center sign-in
(`arn:aws:iam::*:role/aws-reserved/sso.amazonaws.com/*AWSReservedSSO_AdministratorAccess_*`, Mike) and
`OrganizationAccountAccessRole` (the management account's way into each member account). So if something here ever needs
doing, an administrator does it. Developer, Deployer and ViewOnly are all covered.

### Deploying it (Mike, management account, once)

1. Turn on SCPs for the organization (not something CloudFormation can do). AWS keeps the `FullAWSAccess` policy attached
   everywhere, so this alone changes nothing for anyone:

   ```sh
   aws organizations enable-policy-type --root-id r-h7lc --policy-type SERVICE_CONTROL_POLICY --profile figbloom-mgmt
   aws organizations list-roots --profile figbloom-mgmt   # PolicyTypes shows SERVICE_CONTROL_POLICY ENABLED
   ```

2. Check and deploy the stack. It is in eu-west-1 with the rest of the app (CloudFormation manages Organizations
   policies from any commercial Region; the policy itself is global). It uses the `LegacyStackSynthesizer`, so it deploys
   with your own credentials and needs no bootstrap:

   ```sh
   cd infra
   aws sso login --profile figbloom-mgmt
   npm run diff -- FigbloomGuardrails --profile figbloom-mgmt     # one AWS::Organizations::Policy, two account targets
   npx cdk deploy FigbloomGuardrails --profile figbloom-mgmt
   ```

3. Check it:

   ```sh
   aws organizations list-policies --filter SERVICE_CONTROL_POLICY --profile figbloom-mgmt     # figbloom-guardrails
   aws organizations list-targets-for-policy --policy-id <p-... from above> --profile figbloom-mgmt  # the two accounts
   ```

   Then as a developer in staging (`--profile figbloom-staging`), `aws iam create-user --user-name scp-test` should fail
   with `AccessDenied ... with an explicit deny in a service control policy`, and the same command as
   `AdministratorAccess` should be allowed (delete the test user straight after).

To change the policy, edit `GUARDRAILS_POLICY` in `lib/guardrails-stack.ts` (the tests keep it under the 5,120 character
SCP limit), then diff and deploy as above.

### What it doesn't close yet

CDK's execution role (`cdk-hnb659fds-cfn-exec-role-*`) is still an administrator, and it has to be able to create IAM
roles: that is how a stack gets its Lambda roles. So a developer can still deploy a stack in staging that creates a role
with broad rights (even `AdministratorAccess`) and then use it for anything the denies above don't cover. The full fix
is a later step: re-bootstrap staging and production with a permissions boundary, so CloudFormation may only create
roles that carry it, and every role a CDK deploy creates is capped by it:

```sh
npx cdk bootstrap aws://374254524440/eu-west-1 --custom-permissions-boundary <boundary-policy-name> --profile <admin>
```

That needs a boundary policy written first in each account (what app roles may do, and that they can only create roles
with the same boundary), and the app has to attach it to the roles it creates (the `@aws-cdk/core:permissionsBoundary`
context in `cdk.json`, or `PermissionsBoundary.of(...)`). It can be enforced on top with an SCP statement that denies
`iam:CreateRole` without that boundary.
