<#
  itulah Store Server - tray icon for a shop's Windows PC.

  The server runs as a Windows service with nobody signed in, so a person at
  the till has no window to look at. This puts one dot by the clock:

    green   the server is fine
    amber   something is off; hover for what, and whether anyone must act
    red     the server is not running, is holding after repeated crashes,
            or needs someone now
    grey    the server is waiting to be enrolled from head office

  It only READS: it asks the server's loopback console (the same judgement the
  hub shows, `sync/node_status.rs::assess`) and the Windows service state.
  Restarting, backing up and diagnosing are buttons on the console page, which
  the menu opens. A balloon appears when the dot changes colour.

  Installed by the MSI (store.wxs) into the program folder and started at
  every sign-in via HKLM\...\Run. PowerShell 5.1, which every supported Windows
  has; no module, no network beyond localhost.
#>

$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# One tray icon per signed-in person, however many times this is started.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\ItulahStoreTray', [ref]$created)
if (-not $created) { exit 0 }

$Base = 'http://127.0.0.1:8082'
$Service = 'ItulahStore'
$PollSeconds = 15

function New-Dot([System.Drawing.Color]$colour) {
    $bitmap = New-Object System.Drawing.Bitmap 16, 16
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $brush = New-Object System.Drawing.SolidBrush $colour
    $g.FillEllipse($brush, 2, 2, 12, 12)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 0, 0, 0)), 1
    $g.DrawEllipse($pen, 2, 2, 12, 12)
    $g.Dispose()
    [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
}

$Dots = @{
    OK   = New-Dot ([System.Drawing.Color]::FromArgb(22, 163, 74))
    INFO = New-Dot ([System.Drawing.Color]::FromArgb(37, 99, 235))
    WARN = New-Dot ([System.Drawing.Color]::FromArgb(217, 119, 6))
    BAD  = New-Dot ([System.Drawing.Color]::FromArgb(220, 38, 38))
    IDLE = New-Dot ([System.Drawing.Color]::FromArgb(148, 163, 184))
}

function Get-Json([string]$path) {
    # Invoke-WebRequest throws on 4xx/5xx; the body of a 503 is still wanted.
    try {
        $r = Invoke-WebRequest -Uri "$Base$path" -UseBasicParsing -TimeoutSec 5
        return @{ code = [int]$r.StatusCode; body = ($r.Content | ConvertFrom-Json) }
    } catch [System.Net.WebException] {
        $response = $_.Exception.Response
        if ($null -eq $response) { return @{ code = 0; body = $null } }
        $body = $null
        try {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            $body = $reader.ReadToEnd() | ConvertFrom-Json
        } catch { }
        return @{ code = [int]$response.StatusCode; body = $body }
    } catch {
        return @{ code = 0; body = $null }
    }
}

# What the dot says right now: tone, one short line (the tooltip, max 63
# characters), and a longer line for the balloon.
function Read-State {
    $status = Get-Json '/console/status'
    if ($status.code -eq 200 -and $status.body) {
        $a = $status.body.assessment
        return @{ tone = [string]$a.tone; short = [string]$a.label; long = "$($a.headline). $($a.sentence)" }
    }
    if ($status.code -eq 404) {
        # The setup page answers instead of the console: not enrolled yet.
        return @{ tone = 'IDLE'; short = 'Waiting to be enrolled'; long = 'Open Setup and status to enter the code from head office, or wait for head office to approve this machine.' }
    }
    if ($status.code -eq 503) {
        $health = Get-Json '/api/v1/health'
        $said = if ($health.body -and $health.body.message) { [string]$health.body.message } else { 'The server stopped itself after repeated crashes and will try again shortly.' }
        return @{ tone = 'BAD'; short = 'Holding after repeated crashes'; long = $said }
    }
    $svc = Get-Service -Name $Service -ErrorAction SilentlyContinue
    if ($null -eq $svc) {
        return @{ tone = 'BAD'; short = 'Store server not installed'; long = 'The itulah Store service is missing on this PC. Reinstall it, or call head office.' }
    }
    switch ($svc.Status) {
        'StartPending' { return @{ tone = 'WARN'; short = 'Starting'; long = 'The store server is starting. Tills reconnect by themselves.' } }
        'StopPending'  { return @{ tone = 'WARN'; short = 'Stopping'; long = 'The store server is stopping.' } }
        'Running'      { return @{ tone = 'WARN'; short = 'Not answering yet'; long = 'The service is running but not answering. It restarts itself if this lasts.' } }
        default        { return @{ tone = 'BAD'; short = 'Store server stopped'; long = 'The store server is not running. Windows restarts it automatically; if the dot stays red, restart the PC or call head office.' } }
    }
}

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = $Dots.IDLE
$icon.Text = 'itulah Store Server'
$icon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$headline = $menu.Items.Add('Checking...')
$headline.Enabled = $false
[void]$menu.Items.Add('-')
$open = $menu.Items.Add('Open status page')
$open.add_Click({ Start-Process "http://localhost:8082/console" })
$setup = $menu.Items.Add('Setup')
$setup.add_Click({ Start-Process "http://localhost:8082/setup" })
$refresh = $menu.Items.Add('Check now')
[void]$menu.Items.Add('-')
$quit = $menu.Items.Add('Hide this icon')
$icon.ContextMenuStrip = $menu
$icon.add_MouseDoubleClick({ Start-Process "http://localhost:8082/console" })

$script:lastTone = $null

function Update-Dot {
    $state = Read-State
    $tone = if ($Dots.ContainsKey($state.tone)) { $state.tone } else { 'WARN' }
    $icon.Icon = $Dots[$tone]
    $tip = "Store server: $($state.short)"
    $icon.Text = if ($tip.Length -gt 63) { $tip.Substring(0, 60) + '...' } else { $tip }
    $headline.Text = $state.short
    $setup.Visible = ($tone -eq 'IDLE')

    # A balloon when the colour changes, not on every poll. The first reading
    # after sign-in is silent unless something is wrong.
    if ($script:lastTone -ne $tone) {
        $worse = @('WARN', 'BAD') -contains $tone
        $better = $script:lastTone -and (@('WARN', 'BAD') -contains $script:lastTone) -and -not $worse
        if ($worse -or $better) {
            $icon.BalloonTipIcon = switch ($tone) {
                'BAD'  { [System.Windows.Forms.ToolTipIcon]::Error }
                'WARN' { [System.Windows.Forms.ToolTipIcon]::Warning }
                default { [System.Windows.Forms.ToolTipIcon]::Info }
            }
            $icon.BalloonTipTitle = if ($better) { 'Store server is back' } else { "Store server: $($state.short)" }
            $icon.BalloonTipText = $state.long
            $icon.ShowBalloonTip(8000)
        }
        $script:lastTone = $tone
    }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $PollSeconds * 1000
$timer.add_Tick({ Update-Dot })
$refresh.add_Click({ Update-Dot })
$quit.add_Click({
    $timer.Stop()
    $icon.Visible = $false
    $icon.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

Update-Dot
$timer.Start()
[System.Windows.Forms.Application]::Run()
$mutex.ReleaseMutex()
