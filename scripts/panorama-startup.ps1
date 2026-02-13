# Panorama Startup Script for Windows
# Installation: place a shortcut in shell:startup that runs:
#   powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "\\wsl$\Ubuntu\home\davidfm\www\3_boulot\panorama\scripts\panorama-startup.ps1"

# --- 1. Start Docker Desktop if not running ---
$dockerProcess = Get-Process "Docker Desktop" -ErrorAction SilentlyContinue
if (-not $dockerProcess) {
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
}

# Wait for Docker daemon to be ready (max 2 minutes)
$attempts = 0
while ($attempts -lt 24) {
    $result = & docker info 2>&1
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 5
    $attempts++
}

# --- 2. Start Qdrant container ---
& wsl bash -c "docker start qdrant 2>/dev/null || docker run -d --name qdrant -p 6333:6333 -p 6334:6334 qdrant/qdrant"

# --- 3. Start Meteor in WSL (persistent process via daemonize) ---
# Use 'wsl -d Ubuntu' with a bash script that detaches properly
Start-Process -NoNewWindow -FilePath "wsl" -ArgumentList "-d", "Ubuntu", "--", "bash", "-lc", "cd /home/davidfm/www/3_boulot/panoramix/panorama && nohup meteor run --settings settings.json > /tmp/panorama-meteor.log 2>&1 & disown"

# --- 4. Wait for Meteor to be ready, then open browser ---
$attempts = 0
while ($attempts -lt 24) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($response.StatusCode -eq 200) { break }
    } catch {}
    Start-Sleep -Seconds 5
    $attempts++
}

Start-Process "http://localhost:3000"
