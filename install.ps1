#requires -Version 5.1
<#
.SYNOPSIS
    Windows installer for the Monitoring Dashboard.

.DESCRIPTION
    Installs prerequisites check, builds the client, then registers the
    dashboard to start automatically — NSSM service when available,
    otherwise a Scheduled Task at startup. Adds a firewall rule.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File install.ps1
    .\install.ps1 -Port 3000 -InstallDir C:\monitoring-dashboard
#>
param(
    [int]$Port = 3000,
    [string]$InstallDir = "$env:ProgramData\monitoring-dashboard",
    [string]$RepoUrl = "https://github.com/kamikaazeyy/server-monitor.git",
    [string]$ServiceName = "MonitoringDashboard"
)

$ErrorActionPreference = "Stop"

function Log($msg)  { Write-Host "==> $msg" -ForegroundColor Green }
function Warn($msg) { Write-Warning "==> $msg" }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated (Administrator) PowerShell."
}

$arch = $env:PROCESSOR_ARCHITECTURE
Log "Detected: Windows / $arch"
if ($arch -notin @("AMD64", "ARM64")) { Warn "Untested architecture: $arch" }

# ---------- prerequisites ----------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Log "Installing Node.js LTS via winget"
        winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    } else {
        throw "Node.js 18+ is required. Install from https://nodejs.org and re-run."
    }
}
if ([int](node -v).TrimStart('v').Split('.')[0] -lt 18) { throw "Node.js 18+ required (found $(node -v))." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Log "Installing Git via winget"
        winget install --id Git.Git --silent --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    } else {
        throw "Git is required. Install from https://git-scm.com and re-run."
    }
}
Log "Node $(node -v), npm $(npm -v)"

# ---------- fetch source ----------
if (Test-Path (Join-Path $InstallDir ".git")) {
    Log "Updating existing checkout in $InstallDir"
    git -C $InstallDir fetch --depth 1 origin main
    git -C $InstallDir reset --hard origin/main
} elseif (Test-Path ".\index.js") {
    $InstallDir = (Get-Location).Path
    Log "Installing from current directory $InstallDir"
} else {
    Log "Cloning $RepoUrl -> $InstallDir"
    git clone --depth 1 $RepoUrl $InstallDir
}
Set-Location $InstallDir

# ---------- build ----------
Log "Installing dependencies and building client"
npm ci --no-audit --no-fund
Push-Location client
npm ci --no-audit --no-fund
npm run build
Pop-Location

if (-not (Test-Path ".env") -and (Test-Path ".env.example")) { Copy-Item ".env.example" ".env" }
$envLine = "PORT=$Port`r`nHOST=0.0.0.0`r`n"
if (-not (Select-String -Path ".env" -Pattern '^PORT=' -Quiet)) { Add-Content ".env" $envLine }

# ---------- service registration ----------
$nodeExe = (Get-Command node).Source
$envFile = Join-Path $InstallDir ".env"
$runner = Join-Path $InstallDir "scripts\run-windows.ps1"
@"
`$env:PORT = '$Port'
`$env:HOST = '0.0.0.0'
Get-Content '$envFile' | ForEach-Object {
    if (`$_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') { [Environment]::SetEnvironmentVariable(`$matches[1], `$matches[2], 'Process') }
}
Set-Location '$InstallDir'
& '$nodeExe' index.js
"@ | Set-Content -Encoding UTF8 $runner

$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) {
    Log "Registering NSSM service '$ServiceName'"
    & $nssm.Source install $ServiceName (Get-Command powershell).Source "-NoProfile -ExecutionPolicy Bypass -File `"$runner`"" | Out-Null
    & $nssm.Source set $ServiceName AppDirectory $InstallDir | Out-Null
    & $nssm.Source start $ServiceName | Out-Null
} else {
    Log "NSSM not found — registering Scheduled Task at system startup"
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`""
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $ServiceName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName $ServiceName
}

# ---------- firewall ----------
if (-not (Get-NetFirewallRule -DisplayName "Monitoring Dashboard $Port" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Monitoring Dashboard $Port" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
    Log "Firewall rule added for TCP $Port"
}

# ---------- report ----------
Start-Sleep -Seconds 3
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
if (-not $ip) { $ip = "<server-ip>" }
try {
    $null = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
    Log "Health check passed"
} catch {
    Warn "Health check did not respond yet — check the service/task logs."
}
Log "Web UI accessible at http://${ip}:$Port"
Log "First visitor creates the admin account."
Log "Note: web terminal is unavailable on Windows (node-pty); metrics use CIM/PowerShell fallbacks."
