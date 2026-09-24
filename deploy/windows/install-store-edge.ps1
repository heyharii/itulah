[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,

    [string]$InstallPath = (Join-Path $env:ProgramData 'Itulah\StoreEdge')
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this installer from an elevated PowerShell window.'
}

$package = $PSScriptRoot
$binary = Join-Path $package 'store.exe'
$runner = Join-Path $package 'run-store-edge.ps1'
if (-not (Test-Path -LiteralPath $binary)) { throw 'The package is missing store.exe.' }
if (-not (Test-Path -LiteralPath $runner)) { throw 'The package is missing run-store-edge.ps1.' }
if (-not (Test-Path -LiteralPath $ConfigPath)) { throw 'The supplied Store Edge config file does not exist.' }

$configLines = Get-Content -LiteralPath $ConfigPath
$nodeLine = $configLines | Where-Object { $_ -match '^INVENTORY_NODE_ID=' } | Select-Object -First 1
if (-not $nodeLine) { throw 'The Store Edge config must set INVENTORY_NODE_ID.' }
$nodeId = $nodeLine.Substring('INVENTORY_NODE_ID='.Length).Trim()
if ([string]::IsNullOrWhiteSpace($nodeId)) { throw 'INVENTORY_NODE_ID cannot be empty.' }

$portLine = $configLines | Where-Object { $_ -match '^BIND_ADDR=' } | Select-Object -First 1
if (-not $portLine -or $portLine -notmatch ':8082$') {
    throw 'This POS package expects Store Edge to listen on port 8082.'
}

$taskName = 'Itulah Store Edge'
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
Copy-Item -LiteralPath $binary -Destination (Join-Path $InstallPath 'store.exe') -Force
Copy-Item -LiteralPath $runner -Destination (Join-Path $InstallPath 'run-store-edge.ps1') -Force
Copy-Item -LiteralPath $ConfigPath -Destination (Join-Path $InstallPath '.env') -Force

# The sync key and bootstrap password live in .env. Keep the installation
# readable only by Local System and local administrators.
& icacls.exe $InstallPath /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not secure the Store Edge installation directory ACL.' }

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $InstallPath 'run-store-edge.ps1'))
$trigger = New-ScheduledTaskTrigger -AtStartup -RandomDelay (New-TimeSpan -Seconds 10)
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries
$serviceAccount = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $serviceAccount `
    -Description 'Itulah Store Edge API and durable local sync sender.' `
    -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$deadline = (Get-Date).AddSeconds(20)
do {
    Start-Sleep -Milliseconds 500
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8082/api/v1/health' -TimeoutSec 2
        if ($health.node_id -eq $nodeId -and $health.node_role -eq 'STORE') {
            Write-Output "Store Edge is healthy: node=$nodeId task=$taskName"
            exit 0
        }
    } catch {
        # The scheduled task may still be starting. The final error below is
        # deliberately non-secret and points to the protected log location.
    }
} while ((Get-Date) -lt $deadline)

$taskState = (Get-ScheduledTask -TaskName $taskName).State
throw "Store Edge did not pass its health check (task state: $taskState). Inspect $InstallPath\store-edge.log; do not paste .env into chat."
