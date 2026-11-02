# Applies bloomHR's database migrations and edge functions to the self-hosted Supabase on AWS (staging or production),
# from a commit of this repository. See docs/DATABASE_CHANGES.md for when to run it.
#
#   .\scripts\apply-db-changes.ps1 -Env staging -Ref figbloom/my-branch
#   .\scripts\apply-db-changes.ps1 -Env prod -Ref figbloom/my-branch
#
# It packs supabase/ at that commit, uploads it to the environment's backups bucket, and runs apply-migrations.sh on the
# database server through SSM, which takes a backup first (production), lists the pending migrations and applies them.
# The server refuses a database without migration history and more than 10 pending migrations at once.
# Needs: git, the AWS CLI, and `aws sso login --sso-session figbloom-sso`.
param(
  [Parameter(Mandatory = $true)][ValidateSet('staging', 'prod')][string]$Env,
  [Parameter(Mandatory = $true)][string]$Ref
)
$ErrorActionPreference = 'Stop'
$profileName = if ($Env -eq 'prod') { 'figbloom-prod' } else { 'figbloom-staging' }
$region = 'eu-west-1'

$sha = (git rev-parse --short=7 "$Ref^{commit}").Trim()
if (-not $sha) { throw "No commit $Ref (git fetch figbloom first?)" }
Write-Host "bloomHR $sha -> $Env"

# The server and bucket, from the HrDatabase stack (figbloom-platform repo)
$outputs = aws cloudformation describe-stacks --profile $profileName --region $region --stack-name "HrDatabase-$Env" `
  --query 'Stacks[0].Outputs' --output json | ConvertFrom-Json
$instance = ($outputs | Where-Object OutputKey -eq 'InstanceId').OutputValue
$bucket = ($outputs | Where-Object OutputKey -eq 'BackupsBucket').OutputValue
if (-not $instance -or -not $bucket) { throw "Could not read HrDatabase-$Env outputs (run: aws sso login --sso-session figbloom-sso)" }

$work = Join-Path ([IO.Path]::GetTempPath()) "bloomhr-db-$sha"
New-Item -ItemType Directory -Force $work | Out-Null
$bundle = "hr-$sha.tgz"
git archive --format=tar.gz -o (Join-Path $work $bundle) $sha supabase
aws s3 cp --quiet --profile $profileName (Join-Path $work $bundle) "s3://$bucket/migrations/$bundle"
Write-Host "Uploaded $bundle"

# The command goes through a file: Windows PowerShell mangles JSON given inline
$backup = if ($Env -eq 'prod') { './backup.sh && ' } else { '' }
# The server's scripts are refreshed first, so the safety checks in apply-migrations.sh are always the latest
$commands = @{ commands = @(
  'set -o pipefail',
  'cd /opt/figbloom/supabase',
  "aws s3 sync --quiet --region $region s3://$bucket/host-files/ ./ && sed -i 's/\r`$//' ./*.sh && chmod 700 ./*.sh",
  "$backup./apply-migrations.sh $bundle 2>&1 | grep -vE 'Container|Completed|download:'"
) } | ConvertTo-Json
$paramsFile = Join-Path $work 'params.json'
[IO.File]::WriteAllText($paramsFile, $commands)
$commandId = aws ssm send-command --profile $profileName --region $region --instance-ids $instance `
  --document-name AWS-RunShellScript --comment "bloomHR db $sha" `
  --parameters "file://$($paramsFile -replace '\\', '/')" --query Command.CommandId --output text
Write-Host "Running on the server (command $commandId)..."

do {
  Start-Sleep -Seconds 5
  $status = aws ssm get-command-invocation --profile $profileName --region $region --command-id $commandId `
    --instance-id $instance --query Status --output text 2>$null
} while ($status -in @('Pending', 'InProgress', 'Delayed', ''))

foreach ($stream in 'StandardOutputContent', 'StandardErrorContent') {
  $text = aws ssm get-command-invocation --profile $profileName --region $region --command-id $commandId `
    --instance-id $instance --query $stream --output text
  if ($text) { $text | ForEach-Object { Write-Host $_ } }
}
if ($status -eq 'Success') { Write-Host "DONE: $Env is at bloomHR $sha" -ForegroundColor Green }
else { Write-Host "FAILED ($status): nothing after the failing step ran; see above" -ForegroundColor Red; exit 1 }
