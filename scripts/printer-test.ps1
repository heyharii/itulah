<#
    Test a label printer from a borrowed Windows laptop. Nothing to install:
    every command below is Windows PowerShell as it ships.

    The order matters, and each step answers one question:

        .\printer-test.ps1 -Scan                    where is it
        .\printer-test.ps1 -Ask 192.168.1.50        what language does it speak
        .\printer-test.ps1 -Print 192.168.1.50      does a tag come out
        .\printer-test.ps1 -Usb                     it is on USB, not the network

    A printed tag is NOT the end of the test. `^RFW` leaves no ink: a printer
    whose emulation ignores it prints a perfect label with an empty chip, and
    the only way to tell is to read the tag back with a handheld. The EPC below
    is deliberately FF00... so a test tag can never be mistaken for a garment.
#>
[CmdletBinding()]
param(
    [switch] $Scan,
    [string] $Ask,
    [string] $Print,
    [switch] $Usb,
    [int]    $Port = 9100,
    [string] $Subnet
)

$Label = @'
^XA
^PW464
^LL320
^CI28
^FO16,14^A0N,48,48^FDCENTRAL^FS
^FO300,28^A0N,16,16^FD00000000000^FS
^FO16,84^A0N,21,21^FDUJI PRINTER^FS
^FO16,116^A0N,44,44^FDS^FS
^FO59,134^A0N,17,17^FDBlack^FS
^FO16,178^A0N,48,48^FDRp 99.000^FS
^FO16,238^BY2,3,50^BCN,50,Y,N,N^FD00000000000^FS
^RFW,H,1,12,1^FDFF0000000000000000000001^FS
^PQ1,0,1,Y
^XZ
'@

function Send-Raw([string] $Address, [int] $TcpPort, [string] $Payload, [int] $ReadMs = 0) {
    $client = New-Object System.Net.Sockets.TcpClient
    # Short, so a wrong address is a quick answer rather than a long wait.
    if (-not $client.ConnectAsync($Address, $TcpPort).Wait(2000)) {
        throw "no answer from ${Address}:${TcpPort}"
    }
    $stream = $client.GetStream()
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($Payload)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    $reply = ''
    if ($ReadMs -gt 0) {
        $stream.ReadTimeout = $ReadMs
        $buffer = New-Object byte[] 2048
        try {
            $read = $stream.Read($buffer, 0, $buffer.Length)
            if ($read -gt 0) { $reply = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read) }
        } catch { }
    }
    $client.Close()
    return $reply
}

if ($Scan) {
    if (-not $Subnet) {
        $mine = (Get-NetIPAddress -AddressFamily IPv4 |
                 Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
                 Select-Object -First 1).IPAddress
        $Subnet = ($mine -split '\.')[0..2] -join '.'
        Write-Host "this laptop is $mine, sweeping $Subnet.0/24"
    }
    $jobs = 1..254 | ForEach-Object {
        $ip = "$Subnet.$_"
        Start-Job -ArgumentList $ip, $Port -ScriptBlock {
            param($ip, $port)
            $c = New-Object System.Net.Sockets.TcpClient
            if ($c.ConnectAsync($ip, $port).Wait(400)) { $ip }
            $c.Close()
        }
    }
    $found = $jobs | Wait-Job -Timeout 60 | Receive-Job
    $jobs | Remove-Job -Force
    if ($found) { $found | ForEach-Object { Write-Host "  open  ${_}:$Port" } }
    else { Write-Host "  nothing listening on $Port. Check the printer's own self-test page for its address." }
    return
}

if ($Ask) {
    Write-Host "$Ask`:$Port"
    # A reply to ~!T and silence to ~HI means TSPL only: the renderer's ZPL
    # will not print until the printer is switched into emulation.
    foreach ($probe in @(@('TSPL  ~!T', "~!T`r`n"), @('ZPL   ~HI', "~HI`r`n"))) {
        try {
            $reply = Send-Raw $Ask $Port $probe[1] 2500
            if ($reply) { Write-Host ("  {0,-12} -> {1}" -f $probe[0], ($reply.Trim() -replace "`r`n", ' | ')) }
            else        { Write-Host ("  {0,-12} -- silence" -f $probe[0]) }
        } catch { Write-Host ("  {0,-12} -- {1}" -f $probe[0], $_.Exception.Message) }
    }
    return
}

if ($Print) {
    Write-Host "sending one test label to $Print`:$Port"
    Send-Raw $Print $Port $Label | Out-Null
    Write-Host "sent. A tag should come out."
    Write-Host "Now read it with the handheld. The EPC must be FF0000000000000000000001."
    Write-Host "A tag that prints and reads empty means the printer took ^RFW and ignored it."
    return
}

if ($Usb) {
    Write-Host "printers on this laptop:"
    Get-Printer | ForEach-Object { Write-Host ("  {0}   [{1}]" -f $_.Name, $_.PortName) }
    Write-Host ''
    Write-Host "A USB printer has no port 9100. Share it, then send the file raw:"
    Write-Host '  1. Printer properties > Sharing > Share this printer, name it TSC'
    Write-Host '  2. Set-Content -Path label.zpl -Value $Label -Encoding Ascii'
    Write-Host '  3. cmd /c "copy /b label.zpl \\localhost\TSC"'
    Write-Host ''
    Write-Host 'Or run scripts\print-bridge-win.py here, and point the DC bench at this laptop.'
    return
}

Write-Host "Pick one:  -Scan | -Ask <ip> | -Print <ip> | -Usb"
