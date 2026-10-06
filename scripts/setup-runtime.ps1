param(
  [Parameter(Mandatory=$true)][string]$BackendDir,
  [Parameter(Mandatory=$true)][string]$RuntimeRoot,
  [Parameter(Mandatory=$true)][string]$WanSourceDir,
  [string]$TorchIndexUrl = "https://download.pytorch.org/whl/cu126"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$UvVersion = "0.12.23"
$UvUrl = "https://github.com/astral-sh/uv/releases/download/$UvVersion/uv-x86_64-pc-windows-msvc.zip"
$UvSha256 = "75d05de6762778c31ee183398de7dd15093fad0ed90b1f236d8205ea5ec00c90"

function Write-Step([string]$Message) {
  Write-Host "[Wan2.2 Desktop] $Message"
}

function Assert-ExitCode([string]$Message) {
  if ($LASTEXITCODE -ne 0) {
    throw $Message
  }
}

$VenvDir = Join-Path $RuntimeRoot "python"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"
$WanRequirements = Join-Path $WanSourceDir "requirements.txt"
$ToolsDir = Join-Path $RuntimeRoot "tools"
$UvDir = Join-Path $ToolsDir "uv-$UvVersion"
$UvExe = Join-Path $UvDir "uv.exe"

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null

if (-not (Test-Path $UvExe)) {
  Write-Step "Downloading pinned uv $UvVersion..."
  $UvZip = Join-Path $ToolsDir "uv-$UvVersion.zip"
  $UvExtract = Join-Path $ToolsDir "_uv_extract"

  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $UvExtract
  Remove-Item -Force -ErrorAction SilentlyContinue $UvZip

  Invoke-WebRequest -Uri $UvUrl -OutFile $UvZip
  $ActualHash = (Get-FileHash -Algorithm SHA256 $UvZip).Hash.ToLowerInvariant()
  if ($ActualHash -ne $UvSha256) {
    throw "uv checksum mismatch. Expected $UvSha256 but got $ActualHash."
  }

  Expand-Archive -LiteralPath $UvZip -DestinationPath $UvExtract -Force
  New-Item -ItemType Directory -Force -Path $UvDir | Out-Null

  $DownloadedUv = Get-ChildItem -Path $UvExtract -Filter "uv.exe" -Recurse | Select-Object -First 1
  if ($null -eq $DownloadedUv) {
    throw "uv.exe was not found in the downloaded archive."
  }

  Copy-Item $DownloadedUv.FullName $UvExe -Force
  Remove-Item -Recurse -Force $UvExtract
  Remove-Item -Force $UvZip
}

if (-not (Test-Path $PythonExe)) {
  Write-Step "Installing managed Python 3.11..."
  & $UvExe python install 3.11
  Assert-ExitCode "Managed Python installation failed."

  Write-Step "Creating isolated Python environment..."
  & $UvExe venv --python 3.11 --seed $VenvDir
  Assert-ExitCode "Could not create the managed Python environment."
}

Write-Step "Updating pip tooling..."
& $PythonExe -m pip install --upgrade pip setuptools wheel
Assert-ExitCode "pip bootstrap failed."

Write-Step "Installing Wan2.2 Desktop backend..."
& $PythonExe -m pip install $BackendDir
Assert-ExitCode "Backend dependency installation failed."

Write-Step "Installing PyTorch CUDA runtime..."
& $PythonExe -m pip install torch torchvision torchaudio --index-url $TorchIndexUrl
Assert-ExitCode "PyTorch installation failed."

if (-not (Test-Path $WanRequirements)) {
  throw "Wan requirements.txt was not found at $WanRequirements"
}

Write-Step "Installing Wan dependencies..."
$FilteredRequirements = Join-Path $RuntimeRoot "wan-requirements-windows.txt"
Get-Content $WanRequirements |
  Where-Object { $_.Trim() -and -not $_.Trim().StartsWith("flash_attn") } |
  Set-Content -Encoding UTF8 $FilteredRequirements

& $PythonExe -m pip install -r $FilteredRequirements
Assert-ExitCode "Wan dependency installation failed."

Write-Step "Installing Wan source package..."
& $PythonExe -m pip install -e $WanSourceDir --no-deps
Assert-ExitCode "Wan package installation failed."

Write-Step "Using PyTorch SDPA attention fallback on Windows."
$FlashAttentionInstalled = $false

Write-Step "Running runtime diagnostics..."
& $PythonExe (Join-Path $BackendDir "app\runtime_check.py") --wan-source $WanSourceDir
$DiagnosticsExit = $LASTEXITCODE

$result = @{
  ok = ($DiagnosticsExit -eq 0)
  python = $PythonExe
  uv = $UvExe
  flashAttentionInstalled = $FlashAttentionInstalled
  attentionBackend = "torch-sdpa"
  diagnosticsExitCode = $DiagnosticsExit
}

$result | ConvertTo-Json -Compress
if ($DiagnosticsExit -ne 0) {
  exit $DiagnosticsExit
}
