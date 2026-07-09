# Smoke-test a packed Agent-X server tarball on Windows.
# Usage: smoke-server-pack.ps1 <tarball-path> [port]
#
# GitHub Actions windows-latest runs as an Administrator. Embedded PostgreSQL
# refuses to start under an admin account ("Execution of PostgreSQL by a user
# with administrative permissions is not permitted"). This script creates a
# temporary non-admin local user and launches the server via a scheduled task
# (reliable on headless CI; Start-Process -Credential often lacks logon rights).

param(
  [Parameter(Mandatory = $true)][string]$Tarball,
  [int]$Port = 3333
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Tarball)) {
  throw "Tarball not found: $Tarball"
}

$SmokeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("agentx-smoke-" + [guid]::NewGuid().ToString('N'))
$InstallDir = Join-Path $SmokeRoot 'install'
$DataDir = Join-Path $SmokeRoot 'data'
$LogFile = Join-Path $DataDir 'logs\agentx.log'
$WrapperCmd = Join-Path $SmokeRoot 'start-smoke.cmd'
$TaskName = 'AgentXServerSmoke'

$SmokeUser = 'agentxsmoke'
$SmokePasswordPlain = 'AgentX-Smoke-' + [guid]::NewGuid().ToString('N').Substring(0, 12) + '!'
$CreatedUser = $false
$CreatedTask = $false

function Write-Step([string]$Message) {
  Write-Host "==> $Message"
}

function Dump-Log {
  Write-Host '---- agentx.log ----' -ForegroundColor Yellow
  if (Test-Path -LiteralPath $LogFile) {
    Get-Content -LiteralPath $LogFile -ErrorAction SilentlyContinue | Write-Host
  } else {
    Write-Host "(log file missing: $LogFile)"
  }
}

function Ensure-SmokeUser {
  $existing = Get-LocalUser -Name $SmokeUser -ErrorAction SilentlyContinue
  if ($existing) {
    Remove-LocalUser -Name $SmokeUser -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }

  $secure = ConvertTo-SecureString $SmokePasswordPlain -AsPlainText -Force
  # Windows LocalUser.Description max length is 48 characters.
  New-LocalUser `
    -Name $SmokeUser `
    -Password $secure `
    -FullName 'Agent-X Smoke' `
    -Description 'Agent-X CI smoke (non-admin)' `
    -PasswordNeverExpires `
    -UserMayNotChangePassword | Out-Null

  try { Remove-LocalGroupMember -Group 'Administrators' -Member $SmokeUser -ErrorAction SilentlyContinue } catch { }
  try { Add-LocalGroupMember -Group 'Users' -Member $SmokeUser -ErrorAction SilentlyContinue } catch { }

  $script:CreatedUser = $true
  Write-Step "Created non-admin local user '$SmokeUser' for PostgreSQL"
}

function Grant-SmokeAccess {
  & icacls.exe $SmokeRoot /grant "${SmokeUser}:(OI)(CI)F" /T | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "icacls failed granting access to $SmokeRoot for $SmokeUser"
  }
}

function Stop-SmokeServer {
  if ($CreatedTask) {
    try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch { }
    try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue } catch { }
    $script:CreatedTask = $false
  }

  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -match '^(node|postgres|pg_ctl)\.exe$' -and
      $_.CommandLine -and
      $_.CommandLine -like "*$SmokeRoot*"
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Cleanup {
  Stop-SmokeServer
  if ($CreatedUser) {
    try { Remove-LocalUser -Name $SmokeUser -ErrorAction SilentlyContinue } catch { }
  }
  if (Test-Path -LiteralPath $SmokeRoot) {
    Remove-Item -LiteralPath $SmokeRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

try {
  New-Item -ItemType Directory -Path (Join-Path $DataDir 'logs') -Force | Out-Null
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

  Write-Step "Extracting $(Split-Path $Tarball -Leaf) into $InstallDir"
  & tar.exe -xzf $Tarball -C $InstallDir
  if (-not (Test-Path -LiteralPath (Join-Path $InstallDir 'index.js'))) {
    throw 'Missing index.js in tarball'
  }

  $libpq = Join-Path $InstallDir 'node_modules\@embedded-postgres\windows-x64\native\bin\libpq.dll'
  if (-not (Test-Path -LiteralPath $libpq)) {
    throw "Missing embedded Postgres library: $libpq"
  }
  Write-Step 'Embedded Postgres shared libraries present'

  Ensure-SmokeUser
  Grant-SmokeAccess

  # Wrapper carries AGENTX_* env for the scheduled-task process.
  @"
@echo off
set AGENTX_INSTALL_DIR=$InstallDir
set AGENTX_DATA_DIR=$DataDir
set AGENTX_PORT=$Port
set AGENTX_HOST=127.0.0.1
cd /d "$InstallDir"
node index.js >> "$LogFile" 2>&1
"@ | Set-Content -LiteralPath $WrapperCmd -Encoding ASCII

  Grant-SmokeAccess

  try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue } catch { }

  Write-Step "Starting Agent-X server on port $Port as '$SmokeUser' (scheduled task)"
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$WrapperCmd`""
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew
  # Password logon + Limited run level avoids the Administrators elevated token
  # that causes PostgreSQL to refuse startup on Windows.
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Settings $settings `
    -User $SmokeUser `
    -Password $SmokePasswordPlain `
    -RunLevel Limited `
    -Force | Out-Null
  $script:CreatedTask = $true

  Start-ScheduledTask -TaskName $TaskName

  Write-Step 'Waiting for /api/health'
  $ok = $false
  $healthBody = ''
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2
      if ($resp.StatusCode -eq 200) {
        $ok = $true
        $healthBody = $resp.Content
        break
      }
    } catch { }
    Start-Sleep -Seconds 2
  }

  if (-not $ok) {
    Write-Host 'Health check failed after ~120s' -ForegroundColor Red
    Dump-Log
    exit 1
  }
  $preview = if ($healthBody.Length -gt 200) { $healthBody.Substring(0, 200) } else { $healthBody }
  Write-Host "Health OK: $($preview -replace "`r?`n", '')"

  Write-Step 'Fetching Web UI'
  $ui = (Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 10).Content
  if ($ui -notmatch '(?i)<!DOCTYPE|<html') {
    Write-Host 'Web UI response did not look like HTML:' -ForegroundColor Red
    Write-Host ($ui.Substring(0, [Math]::Min(500, $ui.Length)))
    exit 1
  }
  Write-Host "Web UI HTML OK ($($ui.Length) bytes)"

  Write-Step 'Stopping server'
  Stop-SmokeServer

  Write-Step "Smoke test passed for $(Split-Path $Tarball -Leaf)"
  exit 0
} catch {
  Write-Host "Smoke test failed: $($_.Exception.Message)" -ForegroundColor Red
  Dump-Log
  exit 1
} finally {
  Cleanup
}
