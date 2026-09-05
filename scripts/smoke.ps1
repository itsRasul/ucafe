param([string]$TenantHost = "phase4c-cafe.cafexa.localhost")
$ErrorActionPreference = "Stop"
$api = Invoke-WebRequest "http://localhost:3001/api/v1/health/ready"
$web = Invoke-WebRequest "http://localhost:3000/health"
$tenant = Invoke-WebRequest "http://localhost:3000/" -Headers @{ Host = $TenantHost }
if ($api.StatusCode -ne 200 -or $web.StatusCode -ne 200 -or $tenant.StatusCode -ne 200) { throw "Smoke check failed" }
foreach ($header in @("X-Content-Type-Options", "X-Frame-Options", "Content-Security-Policy")) { if (-not $tenant.Headers[$header]) { throw "Missing security header: $header" } }
if ([Text.Encoding]::UTF8.GetByteCount($tenant.Content) -gt 256000) { throw "Tenant HTML exceeds the 250 KiB launch budget" }
Write-Output "Smoke checks passed: readiness, web health, tenant SSR, security headers, HTML budget"
