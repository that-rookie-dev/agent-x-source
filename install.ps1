# Agent-X Installer for Windows
# Usage: irm https://raw.githubusercontent.com/SlashpanOrg/agent-x/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "SlashpanOrg/agent-x"
$InstallDir = if ($env:AGENTX_INSTALL_DIR) { $env:AGENTX_INSTALL_DIR } else { "$env:LOCALAPPDATA\agentx" }
$BinDir = if ($env:AGENTX_BIN_DIR) { $env:AGENTX_BIN_DIR } else { "$env:LOCALAPPDATA\agentx\bin" }
$MinNodeVersion = 20

function Write-Info($msg) { Write-Host "  > $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "  ✗ $msg" -ForegroundColor Red; exit 1 }

# --- Platform detection ---

function Get-Platform {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    switch ($arch) {
        "X64" { return "win-x64" }
        "Arm64" { return "win-arm64" }
        default { Write-Err "Unsupported architecture: $arch" }
    }
}

# --- Prerequisites ---

function Test-NodeVersion {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        Write-Err "Node.js is not installed. Install Node.js >= $MinNodeVersion from https://nodejs.org"
    }
    $version = (node -v) -replace '^v', ''
    $major = [int]($version.Split('.')[0])
    if ($major -lt $MinNodeVersion) {
        Write-Err "Node.js $MinNodeVersion+ required (found v$version). Upgrade: https://nodejs.org"
    }
    Write-Ok "Node.js v$version"
}

# --- Version resolution ---

function Get-LatestVersion {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -ErrorAction Stop
    return $release.tag_name
}

# --- Clean existing ---

function Remove-Existing {
    if (Test-Path $InstallDir) {
        Write-Warn "Removing existing installation at $InstallDir"
        Remove-Item -Recurse -Force $InstallDir
        Write-Ok "Removed $InstallDir"
    }
}

# --- Download and install ---

function Install-AgentX {
    $platform = Get-Platform
    $version = Get-LatestVersion
    Write-Ok "Version: $version"
    Write-Ok "Platform: $platform"

    $url = "https://github.com/$Repo/releases/download/$version/agentx-$platform.zip"
    $tmpFile = Join-Path $env:TEMP "agentx-$platform.zip"

    Write-Info "Downloading agentx-$platform.zip..."
    Invoke-WebRequest -Uri $url -OutFile $tmpFile -ErrorAction Stop

    Write-Info "Installing to $InstallDir..."
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Expand-Archive -Path $tmpFile -DestinationPath $InstallDir -Force
    Remove-Item $tmpFile -Force

    # Create bin directory with agentx.cmd
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    $cmdContent = "@echo off`r`nnode `"$InstallDir\index.js`" %*"
    Set-Content -Path "$BinDir\agentx.cmd" -Value $cmdContent -Encoding ASCII

    Write-Ok "Installed to $InstallDir"
}

# --- PATH management ---

function Add-ToPath {
    $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($userPath -split ";" | Where-Object { $_ -eq $BinDir }) {
        return
    }
    Write-Warn "$BinDir is not in your PATH"
    [Environment]::SetEnvironmentVariable("PATH", "$BinDir;$userPath", "User")
    $env:PATH = "$BinDir;$env:PATH"
    Write-Ok "Added $BinDir to user PATH (restart terminal to take effect)"
}

# --- Verify ---

function Test-Installation {
    if ((Test-Path "$InstallDir\index.js") -and (Test-Path "$BinDir\agentx.cmd")) {
        Write-Ok "Installation verified"
    } else {
        Write-Err "Installation failed — files not found"
    }
}

# --- Install optional dependencies (Tesseract for OCR) ---

function Install-OptionalDeps {
    $tesseract = Get-Command tesseract -ErrorAction SilentlyContinue
    if ($tesseract) {
        Write-Ok "Tesseract OCR already installed"
        return
    }

    # Try choco or winget
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

# --- Main ---

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║         Agent-X Installer             ║" -ForegroundColor Cyan
Write-Host "  ╚═══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Test-NodeVersion
Write-Host ""

Remove-Existing
Install-AgentX
Add-ToPath
Test-Installation
Install-OptionalDeps

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   Agent-X installed successfully! 🚀  ║" -ForegroundColor Green
Write-Host "  ╚═══════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Get started:   agentx"
Write-Host "  Help:          agentx --help"
Write-Host ""
