# ===================================================================
#  RFID Gannomat Tracking System -- Launcher
#  Usage:  .\start.ps1
#  Ctrl+C  stops all services cleanly
# ===================================================================

$Root   = $PSScriptRoot
$Python = "$Root\.venv\Scripts\python.exe"

# Force UTF-8 so colour codes render correctly on all terminals
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding            = [System.Text.Encoding]::UTF8

# ── Header ──────────────────────────────────────────────────────────
Clear-Host
Write-Host ""
Write-Host "  +--------------------------------------------------+" -ForegroundColor Cyan
Write-Host "  |   RFID GANNOMAT TRACKING SYSTEM                  |" -ForegroundColor Cyan
Write-Host "  |   Bobrick Washroom Equipment                     |" -ForegroundColor Cyan
Write-Host "  +--------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

# ── Helper: kill whatever is listening on a port ────────────────────
function Stop-Port {
    param([int]$Port)
    $found = netstat -ano |
        Select-String ":$Port\s" |
        Where-Object  { $_ -match "LISTENING" } |
        ForEach-Object { ($_ -split '\s+')[-1] } |
        Where-Object  { $_ -match '^\d+$' } |
        Select-Object -Unique
    foreach ($p in $found) {
        Stop-Process -Id ([int]$p) -Force -ErrorAction SilentlyContinue
    }
}

# ── Helper: check if a port is listening via netstat ────────────────
function Wait-ForPort {
    param([int]$Port, [int]$Attempts = 20)
    for ($i = 0; $i -lt $Attempts; $i++) {
        Start-Sleep -Milliseconds 500
        $hit = netstat -ano | Select-String ":$Port\s" | Where-Object { $_ -match "LISTENING" }
        if ($hit) { return $true }
    }
    return $false
}

# ── Kill any leftover services ───────────────────────────────────────
Write-Host "  Stopping any existing services ..." -ForegroundColor DarkGray
Stop-Port 5001
Stop-Port 5000
Start-Sleep -Milliseconds 600

# ── Start API (port 5001) ────────────────────────────────────────────
Write-Host "  Starting API server      (port 5001) ..." -ForegroundColor Green
$api = Start-Job -ScriptBlock {
    param($root, $python)
    Set-Location $root
    & $python "$root\api.py" 2>&1
} -ArgumentList $Root, $Python

if (Wait-ForPort 5001) {
    Write-Host "  API ready             -> http://localhost:5001" -ForegroundColor Green
} else {
    Write-Host "  API may not be ready -- check errors below"    -ForegroundColor Yellow
}

# ── Start RFID listener (port 5000) ─────────────────────────────────
Write-Host "  Starting RFID listener   (port 5000) ..." -ForegroundColor Green
$listener = Start-Job -ScriptBlock {
    param($root, $python)
    Set-Location "$root\tracking"
    & $python "$root\tracking\listener.py" 2>&1
} -ArgumentList $Root, $Python

if (Wait-ForPort 5000 -Attempts 10) {
    Write-Host "  Listener ready        -> http://localhost:5000/tags" -ForegroundColor Green
} else {
    Write-Host "  Listener may not be ready -- check errors below"    -ForegroundColor Yellow
}

# ── Detect local IP for the reader config hint ───────────────────────
# Prefer plant LAN (10.25.*) over link-local 169.254.* addresses.
$myIp = (
    Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.IPAddress -notmatch '^127\.' -and
        $_.IPAddress -notmatch '^169\.254\.' -and
        $_.InterfaceAlias -notmatch 'Loopback|vEthernet'
    } |
    Sort-Object @{
        Expression = {
            if ($_.IPAddress -like '10.25.*') { 0 }
            elseif ($_.IPAddress -like '10.*') { 1 }
            else { 2 }
        }
    }, @{ Expression = 'IPAddress' } |
    Select-Object -First 1
).IPAddress

if (-not $myIp) {
    $myIp = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notmatch '^127\.' } |
        Select-Object -First 1).IPAddress
}

# ── Ready banner ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "  --------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  Reader POST target  ->  http://${myIp}:5000/tags" -ForegroundColor White
Write-Host "  Dashboard           ->  http://localhost:5001"     -ForegroundColor White
Write-Host "  Health check        ->  http://localhost:5000/healthz" -ForegroundColor White
Write-Host "  --------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Press Ctrl+C to stop everything" -ForegroundColor DarkYellow
Write-Host ""
Write-Host "==================================================" -ForegroundColor DarkCyan
Write-Host "   LIVE RFID READS" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor DarkCyan
Write-Host ""

$readCount = 0

# ── Live log stream ───────────────────────────────────────────────────
try {
    while ($true) {

        # -- Listener output (RFID reads + session events) -----------
        $lines = Receive-Job $listener 2>$null
        foreach ($line in $lines) {
            # Jobs can emit non-string objects (e.g. ErrorRecord). Coerce to a
            # string so .Trim()/-match never blow up the launcher.
            $line = [string]$line
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            # Skip raw Flask/Werkzeug HTTP access logs
            if ($line -match '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3} - -') { continue }

            if ($line -match "^\[.+\] Qty:" -or $line -match "^\[.+\] Tag:") {
                # Primary read: [HH:MM:SS] Tag: S6IBUS... Ant1 RSSI:-48dBm
                $readCount++
                Write-Host "  >> $line" -ForegroundColor Cyan

            } elseif ($line -match "session.*closed|COMPLETE|Completed") {
                Write-Host "     [DONE ] $($line.Trim())" -ForegroundColor Green

            } elseif ($line -match "session.*open|session_opened|IN_PROGRESS") {
                Write-Host "     [ENTER] $($line.Trim())" -ForegroundColor Yellow

            } elseif ($line -match "DB:\s*\+") {
                Write-Host "     [DB   ] $($line.Trim())" -ForegroundColor DarkCyan

            } elseif ($line -match "ABANDONED|EXIT_ONLY|abandon") {
                Write-Host "     [WARN ] $($line.Trim())" -ForegroundColor DarkYellow

            } elseif ($line -match "[Ee]rror|[Ee]xcep|Traceback") {
                Write-Host "  !! [ERR  ] $($line.Trim())" -ForegroundColor Red

            } elseif ($line -match "Listening on|Waiting for|FX9600|HTTP Listener") {
                Write-Host "     $($line.Trim())" -ForegroundColor DarkGray
            }
        }

        # -- API errors only (suppress normal HTTP traffic logs) -----
        $apiLines = Receive-Job $api 2>$null
        foreach ($line in $apiLines) {
            $line = [string]$line
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            if ($line -match "[Ee]rror|[Ee]xcep|Traceback" -and
                $line -notmatch "NativeCommand|CategoryInfo|FullyQualified|WARNING") {
                Write-Host "  !! [API  ] $($line.Trim())" -ForegroundColor Red
            }
        }

        Start-Sleep -Milliseconds 150
    }
}
finally {
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor DarkGray
    Write-Host "  Stopping all services ..." -ForegroundColor Yellow
    Stop-Job   $listener, $api -ErrorAction SilentlyContinue
    Remove-Job $listener, $api -ErrorAction SilentlyContinue
    Stop-Port 5001
    Stop-Port 5000
    Write-Host "  Stopped. Total RFID reads this session: $readCount" -ForegroundColor Green
    Write-Host ""
}
