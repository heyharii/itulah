$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
& (Join-Path $PSScriptRoot 'store.exe') *>> (Join-Path $PSScriptRoot 'store-edge.log')
exit $LASTEXITCODE
