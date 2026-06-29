# run_all.ps1 - Run all RFID tracking tests
# Run from project root: .\tests\run_all.ps1
# Requires: API on localhost:5001

$Root   = Split-Path $PSScriptRoot -Parent
$Python = "$Root\.venv\Scripts\python.exe"

$tests = @(
    @{ Name = "API Tests";       Script = "$PSScriptRoot\test_api.py" },
    @{ Name = "Database Tests";  Script = "$PSScriptRoot\test_database.py" },
    @{ Name = "Timezone Tests";  Script = "$PSScriptRoot\test_timezone.py" },
    @{ Name = "WebSocket Tests"; Script = "$PSScriptRoot\test_websocket.py" }
)

$passed = 0
$failed = 0
$results = @()

Write-Host ""
Write-Host "=======================================================" -ForegroundColor DarkGray
Write-Host "  RFID Tracking - Test Suite" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor DarkGray

foreach ($t in $tests) {
    Write-Host ""
    Write-Host "--- $($t.Name) ---" -ForegroundColor Yellow

    $output = & $Python $t.Script 2>&1
    $exitCode = $LASTEXITCODE

    foreach ($line in $output) {
        Write-Host "    $line"
    }

    if ($exitCode -eq 0) {
        Write-Host "    PASSED" -ForegroundColor Green
        $passed++
        $results += [PSCustomObject]@{ Test = $t.Name; Result = "PASSED" }
    } else {
        Write-Host "    FAILED (exit $exitCode)" -ForegroundColor Red
        $failed++
        $results += [PSCustomObject]@{ Test = $t.Name; Result = "FAILED" }
    }
}

Write-Host ""
Write-Host "=======================================================" -ForegroundColor DarkGray
Write-Host "  Results:" -ForegroundColor Cyan
foreach ($r in $results) {
    $color = if ($r.Result -eq "PASSED") { "Green" } else { "Red" }
    Write-Host ("  {0,-20} {1}" -f $r.Test, $r.Result) -ForegroundColor $color
}
Write-Host ""
if ($failed -eq 0) {
    Write-Host "  ALL $passed TESTS PASSED" -ForegroundColor Green
} else {
    Write-Host "  $passed passed, $failed FAILED" -ForegroundColor Red
    exit 1
}
Write-Host "=======================================================" -ForegroundColor DarkGray
