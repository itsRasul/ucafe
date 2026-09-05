param([Parameter(Mandatory = $true)][string]$BackupFile)
$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedBackup = (Resolve-Path $BackupFile).Path
if (-not $resolvedBackup.StartsWith($repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Backup file must be inside the repository" }
$database = "ucafe_restore_verify_$(Get-Date -Format 'yyyyMMddHHmmss')"
if ($database -notmatch '^ucafe_restore_verify_[0-9]{14}$') { throw "Unsafe verification database name" }
$containerFile = "/tmp/$database.dump"
try {
  docker compose -f (Join-Path $repositoryRoot "compose.yaml") cp $resolvedBackup "postgres:$containerFile"
  if ($LASTEXITCODE -ne 0) { throw "Copying the backup failed" }
  docker compose -f (Join-Path $repositoryRoot "compose.yaml") exec -T postgres createdb -U ucafe $database
  if ($LASTEXITCODE -ne 0) { throw "Creating the verification database failed" }
  docker compose -f (Join-Path $repositoryRoot "compose.yaml") exec -T postgres pg_restore -U ucafe -d $database --exit-on-error $containerFile
  if ($LASTEXITCODE -ne 0) { throw "Restoring the backup failed" }
  $migrationCount = docker compose -f (Join-Path $repositoryRoot "compose.yaml") exec -T postgres psql -U ucafe -d $database -Atc "SELECT count(*) FROM migrations"
  if ($LASTEXITCODE -ne 0 -or [int]$migrationCount -lt 12) { throw "Restored database failed migration validation" }
  Write-Output "Restore verified with $migrationCount migrations in disposable database $database"
} finally {
  docker compose -f (Join-Path $repositoryRoot "compose.yaml") exec -T postgres dropdb -U ucafe --if-exists $database | Out-Null
  docker compose -f (Join-Path $repositoryRoot "compose.yaml") exec -T postgres rm -f $containerFile | Out-Null
}
