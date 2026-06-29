# RFID Tracking System - Start Script
# Run this from the project root: .\start.ps1

$Root = $PSScriptRoot
$Python = "$Root\.venv\Scripts\python.exe"

# Install dependencies if needed
Write-Host "Checking dependencies..." -ForegroundColor Cyan
& $Python -m pip install -r "$Root\requirements.txt" --quiet

# Start API (port 5001) first — listener forwards events to it
Write-Host "Starting API on port 5001..." -ForegroundColor Green
$api = Start-Job -ScriptBlock {
    param($root, $python)
    & $python "$root\api.py" 2>&1
} -ArgumentList $Root, $Python

Start-Sleep -Seconds 3

# Start listener (port 5000) after API is ready
Write-Host "Starting listener on port 5000..." -ForegroundColor Green
$listener = Start-Job -ScriptBlock {
    param($root, $python)
    & $python "$root\tracking\listener.py" 2>&1
} -ArgumentList $Root, $Python

Write-Host ""
Write-Host "Both services running (Listener Job=$($listener.Id), API Job=$($api.Id))" -ForegroundColor Cyan
Write-Host "  Listener -> http://localhost:5000/tags" -ForegroundColor White
Write-Host "  API      -> http://localhost:5001" -ForegroundColor White
Write-Host ""
Write-Host "Streaming logs (Ctrl+C to stop log view, services keep running):" -ForegroundColor Yellow
Write-Host "-----------------------------------------------------------------" -ForegroundColor DarkGray

try {
    while ($true) {
        $listenerOut = Receive-Job $listener
        $apiOut = Receive-Job $api
        if ($listenerOut) { $listenerOut | ForEach-Object { Write-Host "[LISTENER] $_" -ForegroundColor Cyan } }
        if ($apiOut)      { $apiOut      | ForEach-Object { Write-Host "[API]      $_" -ForegroundColor Green } }
        Start-Sleep -Milliseconds 500
    }
} finally {
    Write-Host ""
    Write-Host "Log stream stopped. To kill services run:" -ForegroundColor Yellow
    Write-Host "  Stop-Job $($listener.Id), $($api.Id)" -ForegroundColor White
}
