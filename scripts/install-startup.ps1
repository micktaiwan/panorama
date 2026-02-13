$shortcutPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Panorama.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wsl.exe"
$shortcut.Arguments = "-d Ubuntu -- /home/davidfm/www/3_boulot/panoramix/scripts/panorama-start.sh"
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output "Shortcut created at: $shortcutPath"
