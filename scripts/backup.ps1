param([string]$OutputDirectory = "backups")
$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$targetDirectory = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $OutputDirectory))
if (-not $targetDirectory.StartsWith($repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Backup directory must stay inside the repository" }
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$containerFile = "/tmp/ucafe-$stamp.dump"
$targetFile = Join-Path $targetDirectory "ucafe-$stamp.dump"
try {
  docker compose -f (Join-Path $repositoryRoot "compose.yaml") exec -T postgres pg_dump -U ucafe -d ucafe --format=custom --file=$containerFile
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
  docker compose -f (Join-Path $repositoryRoot "compose.yaml") cp "postgres:$containerFile" $targetFile
  if ($LASTEXITCODE -ne 0) { throw "Copying the backup failed" }
} finally {
  docker compose -f (Join-Path $repositoryRoot "compose.yaml") exec -T postgres rm -f $containerFile | Out-Null
}
Write-Output $targetFile
