# Monitoramento preditivo de VMs

Complementa o monitoramento de serviços (containers/Loki/Prometheus) com a camada de
**máquinas**: VM parada, VM inacessível, VM muda e disco prestes a encher.

Roda no mesmo processo do worker, em cron próprio (default a cada 2 min), e usa o
**mesmo webhook de chat já configurado** (`ALERT_WEBHOOK_URL`) — o `notifier.ts`
detecta Google Chat pela URL e monta o payload certo. Nenhum webhook novo.

## Ligando

```env
VM_MONITORING_ENABLED=true
MONITOR_HEARTBEAT_TOKEN=<token forte>
```

Desligado por padrão: subir esta versão sem mexer no Infisical não muda nada.

## As quatro detecções

| # | Detecção | Como funciona | Alerta |
|---|---|---|---|
| 1 | VM parada/pausada | consulta o hypervisor a cada ciclo | `down` (crítico) / `paused` (atenção) |
| 2 | VM em queda | TCP nas portas cadastradas + `ping` a partir do host de gerência | `down` após `VM_UNREACHABLE_FAILURES` falhas seguidas |
| 3 | Disco baixo | agente na VM posta `df` a cada 5 min | `disk_warning` / `disk_critical` |
| 4 | Heartbeat ausente | silêncio > `HEARTBEAT_MAX_AGE_MINUTES` | `no_heartbeat` (crítico) |

As quatro são independentes: sem acesso ao hypervisor, 2/3/4 continuam funcionando.

## Descobrindo o acesso disponível

```bash
npm run discover:vms
```

Conecta no `DOCKER_SSH_HOST`, procura `qm` / `virsh` / `govc`, mostra o provider
efetivo e lista as VMs com seus `provider_id` — que é o que você preenche em
`monitoring.vms.provider_id`.

Com `VM_PROVIDER=auto` (default) o worker faz essa mesma sondagem no start e guarda
o resultado em cache; o restart refaz a detecção.

### Precedência dos providers

1. `PROXMOX_API_*` preenchido → API HTTP (enxerga o cluster inteiro, não só o nó do SSH)
2. sondagem SSH → `qm` (Proxmox, QEMU + LXC) → `virsh` (libvirt) → `govc` (VMware)
3. nada encontrado → `none`: ping/TCP + heartbeat

## Cadastro das VMs

```sql
INSERT INTO monitoring.vms (hostname, ip, provider_id, name, enabled)
VALUES ('app-prod-01', '10.0.0.50', '100', 'App Produção 01', true);
```

O casamento com o hypervisor é por `provider_id`; sem ele, o worker tenta pelo nome
reportado — funciona, mas nome muda e colide, então preencha o `provider_id`.

## Lógica preditiva do disco

Sobre `disk_snapshots` dos últimos `DISK_TREND_WINDOW_DAYS` (7), por mount:
regressão linear por mínimos quadrados de `used_gb` no tempo → **GB/dia** →
`(total - used) / slope` = **dias até encher**.

```
🔴 vermelho: uso > DISK_CRITICAL_PERCENT (90%)  OU  projeção < DISK_FORECAST_CRITICAL_HOURS (48h)
🟡 amarelo:  uso > DISK_WARNING_PERCENT  (80%)  OU  projeção < DISK_FORECAST_WARNING_DAYS (7d)
```

Vermelho é avaliado antes do amarelo — um disco a 95% cruza os dois limites, e quem
está de plantão precisa ver o vermelho.

Quando **não** projeta (e só o percentual absoluto vale):
- menos de `DISK_MIN_SAMPLES_FOR_TREND` amostras na janela (agente recém-instalado);
- crescimento zero ou negativo (disco estável ou depois de uma limpeza) — projetar
  "enche em 40 mil dias" não ajuda ninguém.

A escalada de amarelo para vermelho **fecha o amarelo e abre o vermelho**: são tipos
de alerta distintos, senão o cooldown do amarelo seguraria o vermelho por 30 min.

## Anti-spam e resolução

- Mesmo alerta (mesma VM + tipo + mount) não é reenviado antes de
  `VM_ALERT_COOLDOWN_MINUTES` (30).
- O cooldown é medido em `vm_alerts.notified_at` **no banco** — diferente do
  cooldown em memória dos alertas de serviço, sobrevive a restart e deploy.
- Ao normalizar, `resolved_at` é preenchido e sai uma mensagem verde de resolução.
- Enquanto o alerta está aberto, os valores (uso atual, projeção) continuam sendo
  atualizados na linha, mesmo sem reenvio — o dashboard mostra o estado corrente.

## Formato da mensagem no Google Chat

```
🔴 *CRITICAL* — Disco crítico: App Produção 01 (/var)

Disco /var da VM App Produção 01 em estado crítico — projeção de encher em ~31 horas (limite 48h).

• Mount: /var
• Uso atual: 87.4% (437.0 GB de 500.0 GB)
• Projeção: enche em ~31 horas
• Crescimento: 48.20 GB/dia (168 amostras em 7d)
• IP 10.0.0.50
• ID no hypervisor: 100

*Serviço:* App Produção 01  |  *Tipo:* vm  |  *Ambiente:* production
```

## Tabelas

| Tabela | Conteúdo |
|---|---|
| `monitoring.vms` | cadastro: hostname, ip, provider_id, enabled, last_heartbeat_at, contador de falhas |
| `monitoring.vm_status_history` | série de estado (vm_id, status, source, checked_at) |
| `monitoring.disk_snapshots` | série de disco (vm_id, mount, total_gb, used_gb, collected_at) |
| `monitoring.vm_alerts` | alertas (vm_id, type, message, severity, scope, created_at, resolved_at) |

Escolha **um** dos dois caminhos — os dois produzem schema idêntico (verificado
objeto a objeto: 72 colunas, índices, constraints e comentários).

### Opção A — SQL direto (mais próximo de como este schema sempre foi mantido)

```bash
psql -h <host> -U <user> -d monitoring_system -f docs/sql/vm-monitoring.sql
```

Idempotente: pode rodar mais de uma vez sem erro. Também registra a migration em
`monitoring.migrations`, então um `npm run migration:run` posterior responde
"No migrations are pending" em vez de tentar criar tudo de novo.

Desfazer: `docs/sql/vm-monitoring-rollback.sql` (apaga os dados históricos de VM;
não toca nas tabelas de serviço).

### Opção B — migration TypeORM

```bash
npm run migration:run            # de um checkout (usa ts-node sobre src/)
```

Dentro do container de produção, que só tem `dist/` e não instala `ts-node`:

```bash
docker exec monitoring-system-worker npm run migration:run:prod
```

> O deploy **não** roda migrations automaticamente (mesmo comportamento do engine).
> Aplique o schema por um dos caminhos acima depois de subir esta versão e antes
> de ligar `VM_MONITORING_ENABLED=true`.

> Tabela separada de `service_alerts` de propósito: o alvo aqui é a máquina
> (`vm_id` bigint), não o serviço (`service_id` varchar) — misturar quebraria a FK.

## Retenção

`vm_status_history` cresce ~720 linhas/VM/dia e `disk_snapshots` ~288/VM/dia (um por
mount a cada 5 min). Não há expurgo automático nesta entrega; para 7 dias de janela,
uma limpeza periódica é suficiente:

```sql
DELETE FROM monitoring.vm_status_history WHERE checked_at < now() - interval '30 days';
DELETE FROM monitoring.disk_snapshots    WHERE collected_at < now() - interval '30 days';
```

## Agentes nas VMs

Instalação em `agent/README.md` (bash + cron no Linux, PowerShell + Task Scheduler
no Windows).
