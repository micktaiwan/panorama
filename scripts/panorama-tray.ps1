# Panorama System Tray — right-click menu to control Qdrant + Meteor via WSL
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$icoPath = "C:\Users\dfm76\panorama.ico"
$script = "/home/davidfm/www/3_boulot/panoramix/scripts/panorama-start.sh"

# --- Tray icon ---
$notify = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path $icoPath) {
    $notify.Icon = New-Object System.Drawing.Icon($icoPath)
} else {
    $notify.Icon = [System.Drawing.SystemIcons]::Application
}
$notify.Text = "Panorama"
$notify.Visible = $true

# --- Helper: run WSL command and return output ---
function Run-Wsl {
    param([string]$Command)
    $pinfo = New-Object System.Diagnostics.ProcessStartInfo
    $pinfo.FileName = "wsl.exe"
    $pinfo.Arguments = "-d Ubuntu -- bash -lc `"$Command`""
    $pinfo.RedirectStandardOutput = $true
    $pinfo.RedirectStandardError = $true
    $pinfo.UseShellExecute = $false
    $pinfo.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($pinfo)
    $stdout = $p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    return $stdout.Trim()
}

# --- Helper: show balloon ---
function Show-Balloon {
    param([string]$Title, [string]$Text, [int]$Timeout = 5000)
    $notify.BalloonTipTitle = $Title
    $notify.BalloonTipText = if ($Text) { $Text } else { " " }
    $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $notify.ShowBalloonTip($Timeout)
}

# --- Context menu ---
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$qdrantStatus = $menu.Items.Add("Qdrant: ...")
$qdrantStatus.Enabled = $false

$meteorStatus = $menu.Items.Add("Meteor: ...")
$meteorStatus.Enabled = $false

$menu.Items.Add("-")

$startItem = $menu.Items.Add("Start")
$startItem.Add_Click({
    Show-Balloon "Panorama" "Starting Qdrant + Meteor..."
    # Launch via a detached wsl process (not Start-Job)
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo.FileName = "wsl.exe"
    $p.StartInfo.Arguments = "-d Ubuntu -- bash -lc `"$script launch`""
    $p.StartInfo.UseShellExecute = $false
    $p.StartInfo.CreateNoWindow = $true
    $p.Start() | Out-Null
    # Don't wait — services are setsid, they survive
})

$stopItem = $menu.Items.Add("Stop")
$stopItem.Add_Click({
    $result = Run-Wsl "$script stop"
    Show-Balloon "Panorama" $result
})

$menu.Items.Add("-")

$logsItem = $menu.Items.Add("Logs")
$logsItem.Add_Click({
    $result = Run-Wsl "tail -15 /tmp/panorama-meteor.log"
    Show-Balloon "Meteor Logs" $result
})

$browserItem = $menu.Items.Add("Open Browser")
$browserItem.Add_Click({
    Start-Process "http://localhost:3000"
})

$menu.Items.Add("-")

$quitItem = $menu.Items.Add("Quit")
$quitItem.Add_Click({
    if ($global:wslProcess -and -not $global:wslProcess.HasExited) {
        $global:wslProcess.Kill()
    }
    $notify.Visible = $false
    $notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

# --- Update status when menu opens ---
$menu.Add_Opening({
    $qdrantCheck = Run-Wsl "curl -s http://localhost:6333/healthz >/dev/null 2>&1 && echo UP || echo DOWN"
    $meteorCheck = Run-Wsl "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 2>/dev/null"

    $qdrantUp = $qdrantCheck -eq "UP"
    $meteorUp = $meteorCheck -eq "200"

    $qdrantStatus.Text = if ($qdrantUp) { "Qdrant: running" } else { "Qdrant: stopped" }
    $meteorStatus.Text = if ($meteorUp) { "Meteor: running" } else { "Meteor: stopped" }

    $qdrantStatus.ForeColor = if ($qdrantUp) { [System.Drawing.Color]::Green } else { [System.Drawing.Color]::Red }
    $meteorStatus.ForeColor = if ($meteorUp) { [System.Drawing.Color]::Green } else { [System.Drawing.Color]::Red }

    $startItem.Enabled = -not ($qdrantUp -and $meteorUp)
    $stopItem.Enabled = ($qdrantUp -or $meteorUp)
})

$notify.ContextMenuStrip = $menu

# Double-click opens browser
$notify.Add_DoubleClick({
    Start-Process "http://localhost:3000"
})

# --- Auto-start services and keep WSL alive ---
Show-Balloon "Panorama" "Starting Qdrant + Meteor..."
$global:wslProcess = New-Object System.Diagnostics.Process
$global:wslProcess.StartInfo.FileName = "wsl.exe"
$global:wslProcess.StartInfo.Arguments = "-d Ubuntu -- bash -lc `"$script launch; while true; do sleep 3600; done`""
$global:wslProcess.StartInfo.UseShellExecute = $false
$global:wslProcess.StartInfo.CreateNoWindow = $true
$global:wslProcess.Start() | Out-Null

# --- Run event loop ---
[System.Windows.Forms.Application]::Run()

