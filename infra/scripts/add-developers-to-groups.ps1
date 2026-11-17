<#
.SYNOPSIS
  Adds Figbloom's developers to their IAM Identity Center groups. Safe to run again: people already in a group are skipped.

.DESCRIPTION
  The groups come from the FigbloomAccess stack (infra/lib/access-stack.ts); deploy it first. The users are created by
  hand in the Identity Center console (so AWS emails each one an invitation); run this after creating them. Anyone not
  created yet is reported and skipped, so you can run it again once they are.

  Each person below is matched, ignoring upper/lower case, to the Identity Center user whose email is that address, or
  whose user name is that address or the part before the @ (so "Hassan" with email Hassan@figbloom.org matches
  hassan@figbloom.org). Groups are found by name. At the end it lists who is in each group. It prints user names,
  emails, groups and what it did, nothing secret. Needs the AWS CLI v2 and a signed-in profile for the management account (aws sso login --profile ...).

.EXAMPLE
  .\scripts\add-developers-to-groups.ps1 -WhatIf     # show what would change, change nothing
  .\scripts\add-developers-to-groups.ps1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$AwsProfile = 'figbloom-mgmt',
  [string]$Region = 'eu-north-1',
  [string]$IdentityStoreId = 'd-c3676f2769'
)

# Who goes in which group. Group names must match GROUPS in infra/lib/access-stack.ts.
$Membership = [ordered]@{
  'figbloom-developers'     = @('ancel@figbloom.org', 'morris@figbloom.org', 'hassan@figbloom.org', 'given@figbloom.org', 'joseph@figbloom.org')
  'figbloom-prod-viewers'   = @('ancel@figbloom.org', 'hassan@figbloom.org', 'morris@figbloom.org')
  'figbloom-prod-deployers' = @('morris@figbloom.org', 'ancel@figbloom.org')
  'figbloom-leads'          = @('morris@figbloom.org', 'ancel@figbloom.org')
}

# Errors from the AWS CLI are handled through its exit code. ('Stop' would turn its stderr into a terminating error in
# PowerShell 5.1.)
$ErrorActionPreference = 'Continue'
$common = @('--identity-store-id', $IdentityStoreId, '--profile', $AwsProfile, '--region', $Region)

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { Write-Error 'The AWS CLI (aws) is not installed or not on PATH.'; exit 1 }

# Fails early, with a clear message, when the profile isn't signed in
$null = & aws sts get-caller-identity --profile $AwsProfile --region $Region --output text 2>$null
if ($LASTEXITCODE -ne 0) { Write-Error "Not signed in. Run: aws sso login --profile $AwsProfile"; exit 1 }

# Returns the ID for a unique attribute (userName, emails.value, displayName), or $null when there isn't one
function Get-IdByAttribute([string]$Kind, [string]$Path, [string]$Value) {
  # AttributeValue has to be JSON, and PowerShell 5.1 strips the quotes out of JSON passed to a program, so it goes
  # through a temporary file (UTF-8 without BOM)
  $json = @{ UniqueAttribute = @{ AttributePath = $Path; AttributeValue = $Value } } | ConvertTo-Json -Compress
  $file = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText($file, $json)
    $identifier = 'file://' + ($file -replace '\\', '/')
    if ($Kind -eq 'user') {
      $id = & aws identitystore get-user-id --alternate-identifier $identifier --query UserId --output text @common 2>$null
    } else {
      $id = & aws identitystore get-group-id --alternate-identifier $identifier --query GroupId --output text @common 2>$null
    }
  } finally {
    Remove-Item -LiteralPath $file -Force -WhatIf:$false -ErrorAction SilentlyContinue
  }
  if ($LASTEXITCODE -eq 0 -and $id) { return ([string]$id).Trim() }
  return $null
}

# Every user in the identity store, read once (the CLI fetches all pages). Only IDs, user names and emails.
$usersJson = & aws identitystore list-users --query 'Users[].{Id:UserId,UserName:UserName,Emails:Emails[].Value}' --output json @common 2>$null
if ($LASTEXITCODE -ne 0) { Write-Error 'Could not list the Identity Center users.'; exit 1 }
$allUsers = @(($usersJson | Out-String | ConvertFrom-Json))

# PowerShell's -eq and -contains ignore case
function Find-User([string]$Address) {
  $localPart = ($Address -split '@')[0]
  return @($allUsers | Where-Object { $_.UserName -eq $Address -or $_.UserName -eq $localPart -or (@($_.Emails) -contains $Address) })
}

function Get-UserLabel($User) { return "$($User.UserName) <$((@($User.Emails) | Select-Object -First 1))>" }

$results = @()
$problems = 0
foreach ($group in $Membership.Keys) {
  $groupId = Get-IdByAttribute 'group' 'displayName' $group
  if (-not $groupId) {
    Write-Warning "Group $group not found. Deploy the FigbloomAccess stack first."
    foreach ($name in $Membership[$group]) { $results += [pscustomobject]@{ Group = $group; User = $name; Result = 'group missing' } }
    $problems++
    continue
  }
  foreach ($name in $Membership[$group]) {
    $found = Find-User $name
    if ($found.Count -eq 0) {
      $results += [pscustomobject]@{ Group = $group; User = $name; Result = 'user not created yet' }
      $problems++
      continue
    }
    if ($found.Count -gt 1) {
      $results += [pscustomobject]@{ Group = $group; User = $name; Result = "matches $($found.Count) users, fix by hand" }
      $problems++
      continue
    }
    $userId = $found[0].Id
    $label = Get-UserLabel $found[0]
    $null = & aws identitystore get-group-membership-id --group-id $groupId --member-id "UserId=$userId" @common 2>$null
    if ($LASTEXITCODE -eq 0) {
      $results += [pscustomobject]@{ Group = $group; User = $label; Result = 'already a member' }
      continue
    }
    if ($PSCmdlet.ShouldProcess($label, "add to $group")) {
      $null = & aws identitystore create-group-membership --group-id $groupId --member-id "UserId=$userId" @common 2>$null
      if ($LASTEXITCODE -eq 0) {
        $results += [pscustomobject]@{ Group = $group; User = $label; Result = 'added' }
      } else {
        $results += [pscustomobject]@{ Group = $group; User = $label; Result = 'FAILED to add' }
        $problems++
      }
    } else {
      $results += [pscustomobject]@{ Group = $group; User = $label; Result = 'would add (-WhatIf)' }
    }
  }
}

$results | Format-Table -AutoSize | Out-String | Write-Host

# Who is in each group now (straight from Identity Center, so it includes anyone added by hand)
Write-Host 'Group membership now:'
$names = @{}
foreach ($u in $allUsers) { $names[$u.Id] = Get-UserLabel $u }
foreach ($group in $Membership.Keys) {
  $groupId = Get-IdByAttribute 'group' 'displayName' $group
  if (-not $groupId) { Write-Host "  ${group}: (group not found)"; continue }
  $memberIds = & aws identitystore list-group-memberships --group-id $groupId --query 'GroupMemberships[].MemberId.UserId' --output json @common 2>$null
  if ($LASTEXITCODE -ne 0) { Write-Host "  ${group}: (could not list members)"; $problems++; continue }
  $members = @(($memberIds | Out-String | ConvertFrom-Json) | ForEach-Object { if ($names.ContainsKey($_)) { $names[$_] } else { $_ } } | Sort-Object)
  if ($members.Count -eq 0) { Write-Host "  ${group}: (nobody)" } else { Write-Host "  ${group}: $($members -join ', ')" }
}
Write-Host ''
if ($problems -gt 0) {
  Write-Host "$problems item(s) need attention (see above). Fix them and run the script again." -ForegroundColor Yellow
  exit 2
}
Write-Host 'Everyone is in the right groups.' -ForegroundColor Green
