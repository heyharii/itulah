$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# Scheduled Tasks do not reliably inherit a working directory from the
# installer. Explicitly load the protected node config into this process so
# the Rust binary receives the same environment on every boot and restart.
$configPath = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Store Edge config is missing: $configPath"
}

$required = @(
    'INVENTORY_NODE_ID',
    'INVENTORY_SITE_ID',
    'INVENTORY_DATABASE_PATH',
    'BIND_ADDR',
    'INVENTORY_AUTH_MODE',
    'INVENTORY_BOOTSTRAP_ADMIN_PASSWORD',
    'SYNC_UPLOAD_URL',
    'SYNC_UPLOAD_KEY'
)
$loaded = @{}
foreach ($line in Get-Content -LiteralPath $configPath) {
    $entry = $line.Trim()
    if (-not $entry -or $entry.StartsWith('#')) { continue }
    $separator = $entry.IndexOf('=')
    if ($separator -le 0) { throw 'Store Edge config contains a malformed setting.' }

    $name = $entry.Substring(0, $separator).Trim()
    $value = $entry.Substring($separator + 1).Trim()
    if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
        throw 'Store Edge config contains an invalid setting name.'
    }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    $loaded[$name] = $true
}

$missing = @($required | Where-Object { -not $loaded.ContainsKey($_) })
if ($missing.Count -gt 0) {
    throw ('Store Edge config is missing required settings: ' + ($missing -join ', '))
}

& (Join-Path $PSScriptRoot 'store.exe') *>> (Join-Path $PSScriptRoot 'store-edge.log')
exit $LASTEXITCODE
