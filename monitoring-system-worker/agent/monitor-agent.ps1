<#
.SYNOPSIS
    Agente de heartbeat do monitoring-system — Windows.

.DESCRIPTION
    Envia hostname + uso de disco para o worker. Registre no Task Scheduler para
    rodar a cada 5 minutos (veja agent/README.md).

.PARAMETER MonitorUrl
    URL do endpoint. Default: variável de ambiente MONITOR_URL.

.PARAMETER MonitorToken
    Token do worker (MONITOR_HEARTBEAT_TOKEN). Default: variável MONITOR_TOKEN.

.PARAMETER MonitorHostname
    Sobrescreve o hostname enviado. Precisa bater com monitoring.vms.hostname.

.EXAMPLE
    .\monitor-agent.ps1 -MonitorUrl "http://10.10.10.223:5080/monitor/heartbeat" -MonitorToken "..."
#>

[CmdletBinding()]
param(
    [string]$MonitorUrl      = $env:MONITOR_URL,
    [string]$MonitorToken    = $env:MONITOR_TOKEN,
    [string]$MonitorHostname = $env:MONITOR_HOSTNAME,
    [int]$TimeoutSec         = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Log {
    param([string]$Message)
    Write-Output ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
}

# Sem default: o token vai no header, e um destino padrao embutido mandaria a
# credencial para um host que talvez nao seja o certo se a variavel faltar.
# Prefira https:// quando o trafego sair da rede interna.
if ([string]::IsNullOrWhiteSpace($MonitorUrl)) {
    Write-Log 'ERRO: URL nao definida (-MonitorUrl ou variavel MONITOR_URL).'
    exit 1
}
if ([string]::IsNullOrWhiteSpace($MonitorToken)) {
    Write-Log 'ERRO: token nao definido (-MonitorToken ou variavel MONITOR_TOKEN).'
    exit 1
}
if ([string]::IsNullOrWhiteSpace($MonitorHostname)) {
    $MonitorHostname = $env:COMPUTERNAME
}

# TLS 1.2 explicito: Windows Server mais antigo ainda negocia TLS 1.0 por padrao,
# e o POST falharia se o endpoint estiver atras de HTTPS.
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
    # Em PowerShell 7+ isso e irrelevante; nao e motivo para abortar.
}

$disks = @()

try {
    # DriveType 3 = disco local fixo. Exclui CD-ROM, rede e removivel, que nao
    # sao disco da VM e sujariam a serie da projecao.
    $volumes = Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType = 3'

    foreach ($vol in $volumes) {
        if ($null -eq $vol.Size -or $vol.Size -le 0) { continue }

        $totalGb = [math]::Round($vol.Size / 1GB, 2)
        $freeGb  = [math]::Round($vol.FreeSpace / 1GB, 2)
        $usedGb  = [math]::Round($totalGb - $freeGb, 2)
        if ($usedGb -lt 0) { $usedGb = 0 }

        $disks += [pscustomobject]@{
            mount   = $vol.DeviceID   # "C:", "D:" -- e o equivalente do mount no Linux
            totalGb = $totalGb
            usedGb  = $usedGb
        }
    }
} catch {
    Write-Log "ERRO ao coletar discos: $($_.Exception.Message)"
    exit 1
}

if ($disks.Count -eq 0) {
    Write-Log 'AVISO: nenhum disco local encontrado; enviando heartbeat sem discos.'
}

# @($disks) forca array mesmo com um unico disco: sem isso o ConvertTo-Json
# serializa um objeto solto em vez de lista, e o worker descartaria os discos.
$payload = [pscustomobject]@{
    hostname = $MonitorHostname
    disks    = @($disks)
} | ConvertTo-Json -Depth 4 -Compress

$headers = @{
    'Authorization' = "Bearer $MonitorToken"
    'Content-Type'  = 'application/json'
}

try {
    $response = Invoke-RestMethod -Uri $MonitorUrl `
        -Method Post `
        -Headers $headers `
        -Body $payload `
        -TimeoutSec $TimeoutSec

    Write-Log "OK: heartbeat enviado ($MonitorHostname, $($disks.Count) disco(s)) — $($response | ConvertTo-Json -Compress)"
    exit 0
} catch {
    $status = $null
    $body   = $null

    # O corpo da resposta e onde o worker explica o motivo (ex: hostname nao
    # cadastrado); sem ler isso, o log so diria "400 Bad Request".
    try {
        $status = $_.Exception.Response.StatusCode.value__
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $body   = $reader.ReadToEnd()
    } catch {
        # PowerShell 7 ja traz o corpo em ErrorDetails.
        if ($_.ErrorDetails) { $body = $_.ErrorDetails.Message }
    }

    Write-Log "ERRO ao enviar heartbeat (HTTP $status): $body $($_.Exception.Message)"
    exit 1
}
