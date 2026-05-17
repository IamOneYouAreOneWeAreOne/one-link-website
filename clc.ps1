$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$wrapper = Join-Path $scriptDir "tools\clc.py"

$python = Get-Command python -ErrorAction SilentlyContinue
if ($python) {
    & $python.Source $wrapper @args
    exit $LASTEXITCODE
}

& py -3 $wrapper @args
exit $LASTEXITCODE
