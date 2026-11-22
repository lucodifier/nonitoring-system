# Monitoring Worker

Worker que monitora serviços através de múltiplas fontes de dados:
- **Docker**: Verifica status de containers
- **Prometheus**: Coleta métricas (CPU, memória, etc)
- **Loki**: Analisa logs para detectar erros e warnings

O worker executa a cada 15 minutos, atualiza o status dos serviços na base de dados e envia alertas via Discord quando detecta problemas.

Além dos serviços, o worker também faz **monitoramento preditivo de VMs** (VM parada,
VM inacessível, heartbeat ausente e projeção de disco cheio), em ciclo próprio de 2
minutos — desligado por padrão, ligue com `VM_MONITORING_ENABLED=true`.
Veja [docs/vm-monitoring.md](docs/vm-monitoring.md) e [agent/README.md](agent/README.md).

## Requisitos

- Node.js 18+
- PostgreSQL com schema `monitoring`
- Acesso ao Docker (opcional, se usar monitoramento de containers)
- Prometheus (opcional, para métricas)
- Loki (opcional, para análise de logs)
- Discord Webhook (opcional, para notificações)

## Setup

1. Instalar dependências:
```bash
npm install
```

2. Configurar variáveis de ambiente (criar arquivo `.env`):
```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=monitoring_system

# Docker (opcional - configuração global)
# Opção 1: Docker remoto via TCP (se o Docker aceitar conexões remotas)
DOCKER_HOST=your-docker-host        # IP do servidor Docker remoto
DOCKER_PORT=2375                 # Porta do Docker (2375 não-TLS, 2376 TLS)

# Opção 2: Docker local via socket (se worker e containers estão no mesmo servidor)
# DOCKER_SOCKET_PATH=/var/run/docker.sock

# NOTA: Se usar servidor remoto com SSH, veja DOCKER-REMOTE-SETUP.md para opções

# Prometheus (opcional)
PROMETHEUS_URL=http://localhost:9090

# Loki (opcional)
LOKI_URL=http://localhost:3100

# Discord (opcional)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

# Dashboard URL (para links nos alertas)
DASHBOARD_URL=http://localhost:3000

# Intervalo de monitoramento (em minutos, usado para queries do Loki)
MONITORING_INTERVAL_MINUTES=15

# Cron expression (opcional, padrão: a cada 15 minutos)
CRON_EXPRESSION=*/15 * * * *

# Thresholds (opcional - defaults do código)
# Observação: CPU pode passar de 100% (ex.: 208%) quando usa múltiplos núcleos.
CPU_THRESHOLD_PERCENT=80
MEMORY_THRESHOLD_MB=500
ERROR_THRESHOLD_COUNT=10
WARNING_THRESHOLD_COUNT=20
```

3. Configurar serviços na tabela `services`:

Os serviços devem ser cadastrados na tabela `monitoring.services` com os seguintes campos relevantes:

- `id`: Identificador único do serviço (usado como chave primária)
- `name`: Nome do serviço
- `container_id`: ID ou nome do container Docker (opcional)
- `prometheus_job`: Nome do job no Prometheus (opcional)
- `loki_label`: Label usado no Loki para filtrar logs (opcional)
- `is_active`: Se o serviço está ativo para monitoramento

Exemplo de INSERT:
```sql
INSERT INTO monitoring.services (id, name, type, container_id, prometheus_job, loki_label, is_active)
VALUES 
  ('api-service', 'API Service', 'api', 'api-service-container', 'api-service', 'api-service', true),
  ('worker-service', 'Worker Service', 'worker', 'worker-service-container', 'worker-service', 'worker-service', true);
```

## Execução

Executar o worker:
```bash
npm run dev    # Desenvolvimento (ts-node)
npm run build  # Compilar
npm start      # Produção
```

## Funcionamento

1. **Busca Serviços**: O worker busca todos os serviços ativos da tabela `services`
2. **Verifica Containers**: Se `container_id` estiver configurado, verifica se o container está rodando
3. **Coleta Métricas**: Se `prometheus_job` estiver configurado, busca métricas do Prometheus
4. **Analisa Logs**: Se `loki_label` estiver configurado, conta erros e warnings nos últimos 15 minutos
5. **Determina Status**: Calcula o status (UP, DOWN, DEGRADED) baseado nas informações coletadas
6. **Atualiza Banco**: Salva status atual e histórico na base de dados
7. **Gera Alertas**: Se o status não for UP ou houver erros, cria alertas e envia notificações Discord

### Critérios de Status

- **UP**: Container rodando (se configurado), Prometheus indica up (se configurado), sem erros críticos
- **DOWN**: Container não está rodando OU Prometheus indica down
- **DEGRADED**: Muitos erros (>10), CPU alta (>80%), memória alta (>500MB) ou muitos warnings (>20)

### Alertas

Alertas são criados quando:
- Status muda de UP para DOWN/DEGRADED
- Há muitos erros detectados nos logs
- Uso de recursos está acima dos limites

Os alertas são enviados para Discord se `DISCORD_WEBHOOK_URL` estiver configurado.

## Estrutura do Código

```
src/
  ├── entities/          # Entidades TypeORM
  │   ├── Service.ts
  │   ├── ServiceStatusCurrent.ts
  │   ├── ServiceStatusHistory.ts
  │   ├── ServiceAlert.ts
  │   ├── Vm.ts                 # VMs monitoradas
  │   ├── VmStatusHistory.ts
  │   ├── DiskSnapshot.ts       # série de disco (base da projeção)
  │   └── VmAlert.ts
  ├── clients/           # Clients para serviços externos
  │   ├── docker.ts      # Cliente Docker
  │   ├── docker-ssh.ts  # Execução de comandos no host via SSH
  │   ├── prometheus.ts  # Cliente Prometheus
  │   ├── loki.ts        # Cliente Loki
  │   ├── notifier.ts    # Webhook de chat (Discord/Google Chat)
  │   ├── vm-reachability.ts    # sonda TCP + ping via SSH
  │   └── vm-provider/          # drivers de hypervisor (proxmox/libvirt/govc/api)
  ├── services/
  │   ├── disk-forecast.ts      # regressão linear e severidade
  │   └── vm-alerts.ts          # anti-spam e resolução
  ├── http/
  │   └── server.ts             # POST /monitor/heartbeat
  ├── migrations/        # Migrations TypeORM
  ├── scripts/
  │   └── discover-vm-access.ts # npm run discover:vms
  ├── config/
  │   └── vm-config.ts   # env vars do monitoramento de VMs
  ├── data-source.ts     # Configuração TypeORM
  ├── worker.ts          # Ciclo de serviços
  ├── vm-worker.ts       # Ciclo de VMs
  └── index.ts           # Ponto de entrada
```

## Migrations

O schema é versionado com migrations TypeORM:

```bash
npm run migration:run      # aplica as pendentes
npm run migration:revert   # desfaz a última
```

## Notas

- O worker usa TypeORM para acessar o banco de dados
- Se Docker não estiver disponível, o monitoramento de containers será ignorado
- Se Prometheus/Loki não estiverem configurados, essas fontes serão ignoradas
- O worker executa imediatamente ao iniciar e depois a cada 15 minutos (ou conforme CRON_EXPRESSION)
---