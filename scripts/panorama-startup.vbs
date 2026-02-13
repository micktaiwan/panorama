' Panorama Startup Script for Windows
' Place a shortcut to this file in shell:startup
' (Win+R > shell:startup > paste shortcut)
'
' Starts: Docker Desktop + Qdrant + Meteor (via WSL) + opens browser
' Everything is automatic, no manual steps needed.

Set WshShell = CreateObject("WScript.Shell")
Set Fso = CreateObject("Scripting.FileSystemObject")

' --- 1. Start Docker Desktop (if not already running) ---
Dim dockerRunning
dockerRunning = False

On Error Resume Next
WshShell.Run "cmd /c docker info >nul 2>&1", 0, True
If WshShell.Environment("Process")("ERRORLEVEL") = "0" Then dockerRunning = True
On Error GoTo 0

' Check via tasklist if Docker Desktop is already running
Dim checkDocker
Set checkDocker = WshShell.Exec("cmd /c tasklist /FI ""IMAGENAME eq Docker Desktop.exe"" /NH")
Dim taskOutput
taskOutput = checkDocker.StdOut.ReadAll
If InStr(taskOutput, "Docker Desktop.exe") = 0 Then
    ' Docker Desktop is not running, start it
    WshShell.Run """C:\Program Files\Docker\Docker\Docker Desktop.exe""", 0, False
    ' Wait for Docker daemon to be ready (check every 5 seconds, up to 2 minutes)
    Dim attempts
    attempts = 0
    Do While attempts < 24
        WScript.Sleep 5000
        Dim dockerCheck
        Set dockerCheck = WshShell.Exec("cmd /c docker info >nul 2>&1 && echo OK || echo FAIL")
        Dim result
        result = Trim(dockerCheck.StdOut.ReadAll)
        If InStr(result, "OK") > 0 Then Exit Do
        attempts = attempts + 1
    Loop
End If

' --- 2. Start Qdrant container ---
WshShell.Run "wsl bash -c ""docker start qdrant 2>/dev/null || docker run -d --name qdrant -p 6333:6333 -p 6334:6334 qdrant/qdrant""", 0, True

' --- 3. Start Meteor in WSL (background, no visible window) ---
WshShell.Run "wsl bash -lc ""cd /home/davidfm/www/3_boulot/panoramix/panorama && nohup meteor run --settings settings.json > /tmp/panorama-meteor.log 2>&1 &""", 0, False

' --- 4. Wait for Meteor to be ready, then open browser ---
' Poll localhost:3000 every 5 seconds (up to 2 minutes)
Dim meteorReady
meteorReady = False
Dim meteorAttempts
meteorAttempts = 0
Do While meteorAttempts < 24
    WScript.Sleep 5000
    Dim httpCheck
    Set httpCheck = WshShell.Exec("cmd /c curl -s -o nul -w ""%{http_code}"" http://localhost:3000 2>nul")
    Dim httpResult
    httpResult = Trim(httpCheck.StdOut.ReadAll)
    If httpResult = "200" Then
        meteorReady = True
        Exit Do
    End If
    meteorAttempts = meteorAttempts + 1
Loop

If meteorReady Then
    WshShell.Run "http://localhost:3000", 1, False
Else
    ' Open anyway after timeout, Meteor might still be loading
    WshShell.Run "http://localhost:3000", 1, False
End If
