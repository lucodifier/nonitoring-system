# Agente de heartbeat (modelo push)

Scripts que rodam **dentro de cada VM** e enviam hostname + uso de disco para o
worker a cada 5 minutos.

Servem a dois propósitos:

1. **Disco físico baixo** — alimentam `monitoring.disk_snapshots`, que é a série
   usada na projeção linear de enchimento.
2. **Detecção de queda** — a ausência de heartbeat por mais de
   `HEARTBEAT_MAX_AGE_MINUTES` (default 15) gera alerta, mesmo quando não há acesso
   ao hypervisor e o ping não passa.

## Pré-requisito: schema aplicado

As tabelas precisam existir antes: `docs/sql/vm-monitoring.sql` (SQL direto) ou
`npm run migration:run`. Veja [docs/vm-monitoring.md](../docs/vm-monitoring.md).

## Pré-requisito: cadastrar a VM

O endpoint responde **404** para hostname desconhecido — de propósito: uma VM que
ninguém registrou não deve entrar no monitoramento por um POST.

```sql
INSERT INTO monitoring.vms (hostname, ip, provider_id, name, enabled)
VALUES ('app-prod-01', '10.10.10.50', '100', 'App Produção 01', true);
```

- `hostname` **precisa ser exatamente** o que o agente envia (`hostname` no Linux,
  `%COMPUTERNAME%` no Windows). Confira com `hostname` / `echo %COMPUTERNAME%`.
- `provider_id` é o ID no hypervisor (VMID no Proxmox, nome do domínio no libvirt).
  Descubra todos de uma vez com `npm run discover:vms` no worker.
- `ip` é usado no fallback de ping/TCP. Pode ficar nulo se você só usa heartbeat.

## Linux (bash + cron)

```bash
sudo mkdir -p /opt/monitoring
sudo cp monitor-agent.sh /opt/monitoring/
sudo chmod +x /opt/monitoring/monitor-agent.sh

# Token fora do script, com permissão restrita — o script não guarda segredo.
sudo tee /etc/default/monitor-agent >/dev/null <<'EOF'
MONITOR_URL=http://10.10.10.223:5080/monitor/heartbeat
MONITOR_TOKEN=<mesmo valor de MONITOR_HEARTBEAT_TOKEN no worker>
EOF
sudo chmod 600 /etc/default/monitor-agent
```

Teste antes de agendar:

```bash
set -a && . /etc/default/monitor-agent && set +a && /opt/monitoring/monitor-agent.sh
# Esperado: OK: heartbeat enviado (app-prod-01) — {"ok":true,...}
```

Agende no cron do root:

```cron
*/5 * * * * set -a; . /etc/default/monitor-agent; set +a; /opt/monitoring/monitor-agent.sh >> /var/log/monitor-agent.log 2>&1
```

Requisitos: `bash`, `curl`, `df`, `awk` — presentes em qualquer distro padrão.
**Não precisa de `jq`**: o JSON é montado no próprio script.

### Filesystems ignorados

O script descarta pseudo-filesystems (`tmpfs`, `overlay`, `squashfs`, `proc`...),
que não são disco real. Ajuste em `EXCLUDE_FS_TYPES` se o seu caso exigir.

## Windows (PowerShell + Task Scheduler)

```powershell
New-Item -ItemType Directory -Force -Path 'C:\monitoring'
Copy-Item .\monitor-agent.ps1 'C:\monitoring\'

# Token como variável de máquina (não fica no script nem no comando da tarefa)
[Environment]::SetEnvironmentVariable('MONITOR_URL',   'http://10.10.10.223:5080/monitor/heartbeat', 'Machine')
[Environment]::SetEnvironmentVariable('MONITOR_TOKEN', '<token do worker>', 'Machine')
```

Abra um **novo** PowerShell (para as variáveis valerem) e teste:

```powershell
C:\monitoring\monitor-agent.ps1
# Esperado: OK: heartbeat enviado (APP-PROD-01, 2 disco(s)) — {"ok":true,...}
```

Registre a tarefa a cada 5 minutos:

```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\monitoring\monitor-agent.ps1"'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName 'MonitoringHeartbeat' `
    -Action $action -Trigger $trigger -Principal $principal -Settings $settings
```

Coleta apenas discos locais fixos (`Win32_LogicalDisk` com `DriveType = 3`): CD-ROM,
unidade de rede e removível ficam de fora.

## Contrato do endpoint

`POST /monitor/heartbeat`

```
Authorization: Bearer <MONITOR_HEARTBEAT_TOKEN>
Content-Type: application/json
```

```json
{
  "hostname": "app-prod-01",
  "disks": [
    { "mount": "/",     "totalGb": 100.0, "usedGb": 72.5 },
    { "mount": "/var",  "totalGb": 500.0, "usedGb": 410.2 }
  ]
}
```

Respostas:

| Código | Significado |
|---|---|
| 200 | aceito — `{ ok, vmId, disksAccepted, receivedAt }` |
| 400 | JSON inválido ou `hostname` ausente |
| 401 | token ausente ou inválido |
| 404 | `hostname` não cadastrado em `monitoring.vms` |
| 413 | corpo acima de `HEARTBEAT_MAX_BODY_BYTES` (default 64 KB) |
| 503 | worker sem conexão com o banco |

Discos com valores inválidos (total ≤ 0, campo não numérico, mount vazio) são
descartados individualmente, sem invalidar o heartbeat — assim um mount exótico não
faz a VM "sumir" e disparar um alerta falso de heartbeat ausente.

Health check sem autenticação: `GET /monitor/health`.

## Segurança

- **`MONITOR_URL` não tem valor padrão** nos dois agentes, de propósito: o token vai
  no header, e um destino embutido mandaria a credencial para um host que talvez não
  seja o certo caso a variável falte. O agente falha com mensagem clara.
- O token trafega em texto sobre HTTP: use **HTTPS** (atrás de um proxy reverso que
  termine TLS) se o tráfego sair da rede interna. O endpoint do worker fala HTTP
  puro — quem termina TLS é o proxy na frente dele.
- O token é **global**, não por VM: qualquer agente com ele pode enviar heartbeat em
  nome de qualquer VM cadastrada. Aceitável num parque interno fechado; se o modelo
  de ameaça mudar, o caminho é uma credencial por VM.
- Restrinja a porta `HEARTBEAT_PORT` à rede das VMs no firewall do host.
- O endpoint só escreve em `disk_snapshots` e `vms.last_heartbeat_at`, e só para
  hostname já cadastrado — nada é criado a partir de um POST.
