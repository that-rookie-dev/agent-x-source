# Agent-X Installer for Windows — Ground Control Edition
# Usage: irm https://raw.githubusercontent.com/SlashpanOrg/agent-x/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "SlashpanOrg/agent-x"
$InstallDir = if ($env:AGENTX_INSTALL_DIR) { $env:AGENTX_INSTALL_DIR } else { "$env:LOCALAPPDATA\agentx" }
$BinDir = if ($env:AGENTX_BIN_DIR) { $env:AGENTX_BIN_DIR } else { "$env:LOCALAPPDATA\agentx\bin" }
$MinNodeVersion = 20

# ─── Colours ─────────────────────────────────────────────────────────

function Write-Ground($msg) { Write-Host "  $msg" -ForegroundColor DarkGray }
function Write-Info($msg) { Write-Host "  ⏳ $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "  ✗ $msg" -ForegroundColor Red; exit 1 }
function Write-Cmd($msg) { Write-Host "  $msg" -ForegroundColor DarkGray }

# ─── Mission phrases ─────────────────────────────────────────────────

$MissionPhrases = @(
  "Calibrating orbital insertion vectors",
  "Synchronising quantum entanglement buffers",
  "Establishing neural handshake protocol",
  "Deploying phased-array telemetry array",
  "Running pre-flight diagnostic suite",
  "Engaging inertial dampeners",
  "Aligning main reflector dish",
  "Warming up magnetron spindles",
  "Initialising subspace transceiver",
  "Performing cross-check on nav computers",
  "Boosting signal gain on deep-space network",
  "Running parity check on uplink channel",
  "Calculating Lagrange point insertion burn",
  "Spooling up reaction control wheels",
  "Synchronising atomic clock array",
  "Pinging relay satellite constellation",
  "Verifying encryption handshake keys",
  "Charging capacitor banks for main bus",
  "Unfurling solar panel arrays",
  "Loading mission parameters into flight computer",
  "Cross-referencing star charts with telemetry",
  "Running final go/no-go poll",
  "Priming thruster ignition sequence",
  "Acquiring lock on navigation beacon",
  "Stabilising attitude control system",
  "Verifying life support telemetry downlink",
  "Cycling coolant through primary loop",
  "Performing burn-time calculation",
  "Calibrating star tracker against known reference",
  "Checking pressure seals on payload bay",
  "Uploading waypoint sequence to autopilot",
  "Running loopback test on comms channel"
)

function Get-MissionPhrase {
  $idx = (Get-Date).Millisecond % $MissionPhrases.Count
  return $MissionPhrases[$idx]
}

# ─── Signal meter ─────────────────────────────────────────────────────

function Show-SignalMeter {
  param([int]$level)
  $bars = ""
  1..5 | ForEach-Object {
    if ($_ -le $level) {
      $bars += "$([char]0x2588)"  # █
    } else {
      $bars += "$([char]0x2591)"  # ░
    }
  }
  $status = if ($level -le 1) { @{Color="Red"; Text="POOR"} } elseif ($level -le 3) { @{Color="Yellow"; Text="FAIR"} } else { @{Color="Green"; Text="LOCK"} }
  Write-Host "  SIG: $bars $($status.Text)" -ForegroundColor $status.Color
}

# ─── Countdown ──────────────────────────────────────────────────────

function Show-Countdown {
  Write-Host ""
  Write-Host "  T-minus:" -ForegroundColor Cyan
  3..1 | ForEach-Object {
    Write-Host "    $_ seconds to deployment..." -NoNewline -ForegroundColor DarkGray
    Start-Sleep -Seconds 1
    Write-Host "`r" -NoNewline
  }
  Write-Host "  ** LAUNCH **  All systems nominal." -ForegroundColor Green
  Start-Sleep -Milliseconds 500
}

# ─── Platform detection ─────────────────────────────────────────────

function Get-Platform {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
  switch ($arch) {
    "X64" { return "win-x64" }
    "Arm64" { return "win-arm64" }
    default { Write-Err "Unsupported architecture: $arch" }
  }
}

# ─── Prerequisites ──────────────────────────────────────────────────

function Test-NodeVersion {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) {
    Write-Warn "Node.js not found. Attempting to install Node.js..."
    $choco = Get-Command choco -ErrorAction SilentlyContinue
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    $nodeInstalled = $false
    if ($choco) {
      Write-Info "Installing Node.js via Chocolatey..."
      choco install nodejs-lts -y
      $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
      if ($nodeCmd) { $nodeInstalled = $true }
    } elseif ($winget) {
      Write-Info "Installing Node.js via winget..."
      winget install OpenJS.NodeJS.LTS
      $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
      if ($nodeCmd) { $nodeInstalled = $true }
    }
    if (-not $nodeInstalled) {
      Write-Err "Node.js could not be installed automatically. Please install Node.js >= $MinNodeVersion manually:"
      Write-Host "    choco install nodejs-lts" -ForegroundColor Cyan
      Write-Host "    winget install OpenJS.NodeJS.LTS" -ForegroundColor Cyan
      Write-Host "    Or download from: https://nodejs.org/en/download" -ForegroundColor Cyan
    }
  }
  $version = (node -v) -replace '^v', ''
  $major = [int]($version.Split('.')[0])
  if ($major -lt $MinNodeVersion) {
    Write-Err "Node.js $MinNodeVersion+ required (found v$version). Upgrade: https://nodejs.org"
  }
  Write-Ok "Node.js v$version"
}

# ─── Version resolution ─────────────────────────────────────────────

function Get-LatestVersion {
  Write-Progress -Activity "Resolving latest release tag from GitHub..." -Status "downlinking" -PercentComplete -1
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -ErrorAction Stop
  Write-Progress -Activity "Resolving latest release tag from GitHub..." -Completed
  return $release.tag_name
}

# ─── Clean existing ─────────────────────────────────────────────────

function Remove-Existing {
  if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir
  }
}

# ─── Download server payload ────────────────────────────────────────

function Install-AgentX {
  $platform = Get-Platform
  if ($platform -ne "win-x64") {
    Write-Err "Server install is only available for win-x64 (found $platform)."
  }
  $version = Get-LatestVersion
  Write-Ok "Latest release: $version"
  Write-Ground "Telemetry: $platform | Node $(node -v) | $version"
  Write-Ground "Payload: Server (headless Web UI)"

  $url = "https://github.com/$Repo/releases/download/$version/agentx-$platform-server.tar.gz"
  $tmpFile = Join-Path $env:TEMP "agentx-$platform-server.tar.gz"

  Write-Cmd "Downlinking from: $url"

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

  try {
    Invoke-WebRequest -Uri $url -OutFile $tmpFile -UseBasicParsing -ErrorAction Stop
  } catch {
    Write-Err "Download failed for $url. Check your internet connection or set AGENTX_VERSION."
  }

  if (-not (Test-Path $tmpFile) -or (Get-Item $tmpFile).Length -eq 0) {
    Write-Err "Download failed. Check your internet connection."
  }

  $header = Get-Content -Path $tmpFile -Encoding Byte -TotalCount 2
  if ($header[0] -ne 0x1f -or $header[1] -ne 0x8b) {
    Write-Err "Downloaded file is not a valid server package (expected gzip). Asset may be missing for $platform in $version."
  }

  Write-Cmd "Unpacking payload..."
  tar -xzf $tmpFile -C $InstallDir
  Remove-Item $tmpFile -Force

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  if (Test-Path "$InstallDir\agentx.cmd") {
    Copy-Item "$InstallDir\agentx.cmd" "$BinDir\agentx.cmd" -Force
  } else {
    $cmdContent = "@echo off`r`nnode `"$InstallDir\index.js`" %*"
    Set-Content -Path "$BinDir\agentx.cmd" -Value $cmdContent -Encoding ASCII
  }

  Write-Ok "Payload extracted to $InstallDir"
}

# ─── PATH management ────────────────────────────────────────────────

function Add-ToPath {
  $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
  if ($userPath -split ";" | Where-Object { $_ -eq $BinDir }) {
    return
  }
  Write-Warn "$BinDir is not in your PATH"
  [Environment]::SetEnvironmentVariable("PATH", "$BinDir;$userPath", "User")
  $env:PATH = "$BinDir;$env:PATH"
  Write-Ok "Navigation beacon added to PATH"
  $shell = (Get-Process -Id $PID).Path
  if ($shell -like "*powershell*") {
    Write-Host "  Reloading navigation charts for this session..." -ForegroundColor Cyan
    $env:PATH = [Environment]::GetEnvironmentVariable("PATH", "User")
    Write-Host "  If 'agentx' is still not found, restart your terminal or run: `n    `$env:PATH = [Environment]::GetEnvironmentVariable(\"PATH\", \"User\")" -ForegroundColor Yellow
  } else {
    Write-Host "  Please restart your terminal to use 'agentx', or run: `n    `$env:PATH = [Environment]::GetEnvironmentVariable(\"PATH\", \"User\")" -ForegroundColor Yellow
  }
}

# ─── Verify ─────────────────────────────────────────────────────────

function Test-Installation {
  if ((Test-Path "$InstallDir\index.js") -and (Test-Path "$BinDir\agentx.cmd")) {
    Write-Ok "Payload integrity verified"
  } else {
    Write-Err "Installation failed - payload integrity check failed"
  }
}

# ─── Install optional dependencies (Tesseract for OCR) ──────────────

function Install-OptionalDeps {
  $tesseract = Get-Command tesseract -ErrorAction SilentlyContinue
  if ($tesseract) {
    return
  }

  $choco = Get-Command choco -ErrorAction SilentlyContinue
  $winget = Get-Command winget -ErrorAction SilentlyContinue

  if ($choco) {
    Write-Info "Installing Tesseract OCR via Chocolatey..."
    choco install tesseract -y 2>$null | Out-Null
    if ($?) { Write-Ok "Tesseract OCR installed"; return }
  }
  if ($winget) {
    Write-Info "Installing Tesseract OCR via winget..."
    winget install UB-Mannheim.TesseractOCR --silent 2>$null | Out-Null
    if ($?) { Write-Ok "Tesseract OCR installed"; return }
  }

  Write-Warn "Tesseract OCR not installed (needed for image text extraction)"
  Write-Host "    Install manually: choco install tesseract  OR  winget install UB-Mannheim.TesseractOCR" -ForegroundColor DarkGray
}

# ─── Animated step runner ───────────────────────────────────────────

function Run-Step($msg, [ScriptBlock]$block) {
  Write-Progress -Activity $msg -Status "$(Get-MissionPhrase)" -PercentComplete -1
  try {
    & $block
    Write-Progress -Activity $msg -Completed
    Write-Ok $msg
  } catch {
    Write-Progress -Activity $msg -Completed
    Write-Err "$msg failed: $_"
  }
}

# ─── Main ───────────────────────────────────────────────────────────

Clear-Host
Write-Host ""
Write-Host "  MISSION CONTROL • AGENT-X DEPLOYMENT" -ForegroundColor Cyan
Write-Host "  ------------------------------------" -ForegroundColor DarkGray
Show-SignalMeter -level (Get-Random -Minimum 3 -Maximum 6)
Write-Host "  STAT: PRE-LAUNCH" -ForegroundColor Cyan
Write-Host "  T+$([DateTimeOffset]::Now.ToUnixTimeSeconds()): $(Get-Date -Format 'HH:mm:ss UTC')" -ForegroundColor DarkGray
Write-Host ""

Run-Step "Running pre-flight diagnostics" {
  Test-NodeVersion
}

Show-Countdown

Run-Step "Clearing previous installation artifacts" {
  Remove-Existing
}

Install-AgentX

Run-Step "Locking navigation coordinates" {
  Add-ToPath
}

Run-Step "Running payload integrity check" {
  Test-Installation
}

Run-Step "Installing auxiliary sensors (OCR)" {
  Install-OptionalDeps
}

Write-Host ""
Write-Host "  ** DEPLOYMENT COMPLETE **" -ForegroundColor Green
Write-Host "  Agent-X server is now operational." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Payload:     Server (Web UI)" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Engage:      agentx start"
Write-Host "  Status:      agentx status"
Write-Host "  Stop:        agentx stop"
Write-Host "  Web UI:      http://127.0.0.1:3333"
Write-Host "  Help:        agentx --help"
Write-Host ""
