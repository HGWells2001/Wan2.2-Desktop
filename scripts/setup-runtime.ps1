param(
  [Parameter(Mandatory=$true)][string]$BackendDir,
  [Parameter(Mandatory=$true)][string]$RuntimeRoot,
  [Parameter(Mandatory=$true)][string]$WanSourceDir,
  [string]$PythonCommand = "python",
  [string]$TorchIndexUrl = "https://download.pytorch.org/whl/cu126"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$Message) {
  Write-Host "[Wan2.2 Desktop] $Message"
}

$VenvDir = Join-Path $RuntimeRoot "python"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"
$WanRequirements = Join-Path $WanSourceDir "requirements.txt"

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null

if (-not (Test-Path $PythonExe)) {
  Write-Step "Creating Python virtual environment..."
  & $PythonCommand -m venv $VenvDir
  if ($LASTEXITCODE -ne 0) { throw "Could not create the Python virtual environment." }
}

Write-Step "Updating pip tooling..."
& $PythonExe -m pip install --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) { throw "pip bootstrap failed." }

Write-Step "Installing Wan2.2 Desktop backend..."
& $PythonExe -m pip install $BackendDir
if ($LASTEXITCODE -ne 0) { throw "Backend dependency installation failed." }

Write-Step "Installing PyTorch CUDA runtime..."
& $PythonExe -m pip install torch torchvision torchaudio --index-url $TorchIndexUrl
if ($LASTEXITCODE -ne 0) { throw "PyTorch installation failed." }

if (-not (Test-Path $WanRequirements)) {
  throw "Wan requirements.txt was not found at $WanRequirements"
}

Write-Step "Installing Wan dependencies except flash_attn..."
$FilteredRequirements = Join-Path $RuntimeRoot "wan-requirements-no-flash.txt"
Get-Content $WanRequirements |
  Where-Object { $_.Trim() -and -not $_.Trim().StartsWith("flash_attn") } |
  Set-Content -Encoding UTF8 $FilteredRequirements

& $PythonExe -m pip install -r $FilteredRequirements
if ($LASTEXITCODE -ne 0) { throw "Wan dependency installation failed." }

Write-Step "Installing Wan source package..."
& $PythonExe -m pip install -e $WanSourceDir --no-deps
if ($LASTEXITCODE -ne 0) { throw "Wan package installation failed." }

$FlashAttentionInstalled = $true
Write-Step "Trying optional flash_attn installation..."
& $PythonExe -m pip install flash_attn --no-build-isolation
if ($LASTEXITCODE -ne 0) {
  $FlashAttentionInstalled = $false
  Write-Warning "flash_attn could not be installed. The rest of the runtime is ready; diagnostics will report this separately."
}

Write-Step "Running runtime diagnostics..."
& $PythonExe (Join-Path $BackendDir "app\runtime_check.py") --wan-source $WanSourceDir
$DiagnosticsExit = $LASTEXITCODE

$result = @{
  ok = ($DiagnosticsExit -eq 0)
  python = $PythonExe
  flashAttentionInstalled = $FlashAttentionInstalled
  diagnosticsExitCode = $DiagnosticsExit
}

$result | ConvertTo-Json -Compress
if ($DiagnosticsExit -ne 0) {
  exit $DiagnosticsExit
}
