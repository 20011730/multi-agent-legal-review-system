$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $root "docker-compose.yml"
$backendDir = Join-Path $root "backend"

Set-Location $backendDir
Remove-Item Env:\SPRING_PROFILES_ACTIVE -ErrorAction SilentlyContinue

$usedDocker = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
    try {
        docker info 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Starting PostgreSQL (Docker)..."
            docker compose -f $composeFile up -d
            if ($LASTEXITCODE -ne 0) { throw "docker compose exited $LASTEXITCODE" }
            Start-Sleep -Seconds 5
            $usedDocker = $true
            Write-Host "Backend will use PostgreSQL on localhost:5432 -> http://localhost:8080"
        }
    } catch {
        Write-Warning "Docker path failed: $_"
    }
}

if (-not $usedDocker) {
    Write-Host "Using H2 in-memory DB (profile: local). No Docker required -> http://localhost:8080"
    $env:SPRING_PROFILES_ACTIVE = "local"
}

$port = 8080
if ($env:SERVER_PORT) { $port = [int]$env:SERVER_PORT }
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
    Write-Host ""
    Write-Host "[오류] 포트 $port 이(가) 이미 사용 중이라 백엔드를 또 띄울 수 없습니다." -ForegroundColor Red
    Write-Host "  - 예전에 켜 둔 Spring Boot 터미널이 있으면 그 창에서 Ctrl+C 로 종료하세요."
    Write-Host "  - 또는 작업 관리자에서 해당 java.exe 프로세스를 종료하세요."
    foreach ($c in $listeners | Select-Object -First 3) {
        try {
            $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
            if ($p) { Write-Host "  - PID $($p.Id): $($p.ProcessName)" }
        } catch { }
    }
    Write-Host ""
    exit 1
}

& .\gradlew.bat bootRun
