# Run TiLT in your normal web browser on THIS computer (Windows PowerShell).
#   scripts\tilt-local.ps1 [--port N] [--root <storage dir>] [--no-open]
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (-not (Test-Path 'apps/desktop/dist/index.html')) {
  Push-Location apps/desktop; npm ci; npm run build; Pop-Location
}
cargo build --release -p tilt-local
& .\target\release\tilt-local.exe --ui apps\desktop\dist @args
