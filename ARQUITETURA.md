# Monitoring System — Arquitetura e Provisionamento

Plataforma interna de monitoramento de serviços (containers Docker) e VMs de um parque de servidores.
Coleta saúde, logs e métricas, persiste em PostgreSQL, alerta em chat (Discord / Google Chat) e exibe tudo
num dashboard web em tempo real.

São **4 repositórios/projetos** nesta pasta:

| Pasta | Papel | Stack | Porta (prod) |
|---|---|---|---|
| `monitoring-system-worker` | **Coletor + alertas + VMs** (escreve no banco) | Node 20, TypeScript, TypeORM, cron | 5080 (heartbeat) |
| `monitoring-system-engine` | **API REST + WebSocket** (lê o banco) | NestJS 10, TypeORM, JWT, Swagger | 5070 |
| `monitoring-system-dashboard` | **Interface web** | React + Vite + shadcn/ui, servida por Express | 5068 |
| `monitoring-system` | **Alertador de erros por logs** (independente, legado) | Node 20 ESM, 1 arquivo | — (sem porta) |

---

## 1. Visão geral

```
                    ┌───────────────────── Parque de servidores ─────────────────────┐
                    │  Host Docker      Loki        Prometheus     Hypervisor (Proxmox/ │
                    │  (containers)   (logs)        (métricas)     libvirt/VMware)      │
                    │      ▲  SSH        ▲ HTTP       ▲ HTTP           ▲ SSH/API        │
                    │      │             │            │                │   VMs com agente│
                    └──────┼─────────────┼────────────┼────────────────┼───────┬─────────┘
                           │             │            │                │       │ POST /monitor/heartbeat
                    ┌──────┴─────────────┴────────────┴────────────────┴───────▼────────┐
                    │                  monitoring-system-worker                          │
                    │  cron serviços (15m) · cron VMs (2m) · endpoint heartbeat (:5080)  │
                    └───────────────┬─────────────────────────────────┬──────────────────┘
                                    │ grava                           │ alerta
                                    ▼                                 ▼
                    ┌──────────────────────────────┐        Discord / Google Chat
                    │ PostgreSQL  schema monitoring │
                    └──────────────┬───────────────┘
                                   │ lê
                    ┌──────────────┴───────────────┐        Loki (consulta de logs
                    │    monitoring-system-engine   │◄──────  sob demanda) · Docker via SSH
                    │  REST /api/v1 · WS /metrics   │        (ações no host)
                    └──────────────┬───────────────┘
                                   │ HTTP + WebSocket
                    ┌──────────────┴───────────────┐
                    │  monitoring-system-dashboard  │  ← usuário (login JWT)
                    └──────────────────────────────┘

        monitoring-system  (isolado) ── Loki ──► Discord / e-mail (API de mensageria)
```

**Regra de ouro:** worker e engine compartilham **o mesmo banco** e **o mesmo schema** (`monitoring`).
O worker é o único que *produz* dados de status; o engine apenas expõe. Eles não se chamam por HTTP.

---

## 2. Para que serve cada um

### 2.1 `monitoring-system-worker` — o coletor

Processo de fundo (sem UI). Ao subir, conecta no banco, roda um ciclo imediato e agenda crons.

**Ciclo de serviços** (`CRON_EXPRESSION`, default `*/15 * * * *`): para cada linha ativa de `monitoring.services`:
1. **Docker** (`container_id`): container está rodando? CPU/memória. Via SSH no host (preferido), socket local ou TCP.
   Só marca `DOWN` quando *confirma* que parou — erro de conexão vira `unknown`, evitando falso positivo.
2. **Prometheus** (`prometheus_job`): `up`, CPU %, memória MB.
3. **Logs** (`loki_label`): conta erros/warnings na janela `MONITORING_INTERVAL_MINUTES`. Com `LOKI_ENABLED=false`
   cai no fallback que lê `docker logs` via SSH (não exige Loki).
4. **Status**: `UP` · `DOWN` (container parado ou `up==0`) · `DEGRADED` (erros > 10, CPU > 80 %, memória > 500 MB, warnings > 20 — configurável).
5. **Persistência**: `service_status_current` (último estado) e `service_status_history` (série).
6. **Alertas**: cria `service_alerts` (sem duplicar alerta aberto) e notifica o webhook, com cooldown (`ALERT_RESEND_COOLDOWN_MINUTES`). Também alerta disco do host SSH (`DISK_THRESHOLD_PERCENT`).

**Monitoramento preditivo de VMs** (opcional, `VM_MONITORING_ENABLED=true`, ciclo `VM_CRON_EXPRESSION` = 2 min). Quatro detecções independentes:

| Detecção | Como | Alerta |
|---|---|---|
| VM parada/pausada | pergunta ao hypervisor (Proxmox API/SSH, libvirt, govc) | `down` / `paused` |
| VM inacessível | TCP nas portas + ping a partir do host de gerência | `down` após N falhas |
| Disco baixo/projeção | agente na VM envia `df`; regressão linear → dias até encher | `disk_warning` / `disk_critical` |
| Heartbeat ausente | silêncio > `HEARTBEAT_MAX_AGE_MINUTES` | `no_heartbeat` |

O worker expõe `POST /monitor/heartbeat` (Bearer `MONITOR_HEARTBEAT_TOKEN`) e `GET /monitor/health`.
Os **agentes** (`monitoring-system-worker/agent/`) são scripts bash (cron) e PowerShell (Task Scheduler) instalados dentro de cada VM, enviando hostname + discos a cada 5 min.
Detalhes: `monitoring-system-worker/docs/` (`comofunciona.md`, `vm-monitoring.md`, `discovery_docker.md`) e `agent/README.md`.

### 2.2 `monitoring-system-engine` — a API

NestJS com prefixo `/api/v1`, Swagger em `/api/docs`, autenticação JWT (bcrypt), validação estrita (`whitelist` + `forbidNonWhitelisted`) e CORS aberto.

| Módulo | Função |
|---|---|
| `auth` / `identities` | login (`POST /auth/login`), perfil, usuários na tabela `monitoring.users` |
| `services` | lista serviços, status atual/histórico, erros e alertas por serviço; `docker.service` age no host via SSH |
| `metrics` | `dashboard-summary`, CPU/memória, erros/min, uptime + **gateway WebSocket** `/metrics` (push a cada 5 s) |
| `alerts` | listar, reconhecer (`acknowledge`), resolver (`resolve`) |
| `errors` | últimos erros capturados |
| `logs` | consulta de logs no Loki sob demanda (`loki.service`) |
| `deployment` | checklist de prontidão de deploy |
| `vms` | saúde das VMs, disco e projeção (`disk-forecast`), habilitar/desabilitar VM |

### 2.3 `monitoring-system-dashboard` — a interface

SPA React (Vite, Tailwind, shadcn/ui, Recharts) servida por um Express mínimo (`server/index.ts`).
Páginas: Login, Home (cards, saúde, recursos, alertas recentes), Services / ServiceDetails, Vms / VmDetails, Alerts, Logs, Deployment.
Atualiza em tempo real por WebSocket (`useSocket`) com fallback HTTP.

**Config em runtime, sem rebuild:** o Express injeta `window.__ENV__` no `index.html` a partir das `VITE_*` do container
(prioridade `window.__ENV__` > `import.meta.env` > default). Uma imagem serve todos os ambientes.
Pendências conhecidas em `DASHBOARD_STATUS.md` (Total Requests, Avg Response Time e histórico de rede ainda sem backend; gráfico de tráfego é simulado).

### 2.4 `monitoring-system` — alertador por logs (independente)

Script único (`worker-monitor.js`) **sem banco e sem engine/dashboard**. A cada 15 min (cron fixo) consulta o Loki por serviço
(`{job="<svc>"} | json | level>=40 ...`, modo `pino_extended`) e envia resumo para Discord (global e/ou webhook por serviço) e
e-mail (via API de mensageria interna, payload `{system, subjectCode, notificationType, recipients, metadata}`).
Tem lista padrão de ~16 serviços (sobrescreva com `SERVICES`). É a geração anterior do alerta: o worker novo cobre o mesmo caso
(contagem de erros em logs) e mais, mas este continua útil como alertador leve, por e-mail, sem depender do banco.

---

## 3. Como provisionar

### 3.1 Pré-requisitos de infraestrutura

| Item | Obrigatório | Observação |
|---|---|---|
| PostgreSQL 12+ | sim (worker + engine) | banco `monitoring_system`, schema `monitoring` |
| Host Docker acessível por SSH | sim p/ monitorar containers | usuário com permissão de `docker` |
| Loki | opcional | sem ele, `LOKI_ENABLED=false` usa `docker logs` via SSH. Obrigatório para o alertador `monitoring-system` e para a tela Logs |
| Prometheus | opcional | só se usar `prometheus_job` |
| Webhook Discord ou Google Chat | recomendado | destino dos alertas |
| Hypervisor (Proxmox/libvirt/VMware) | opcional | só para a parte de VMs |
| Docker + registry (GHCR) | produção | imagens `ghcr.io/agroplay-music-ltda/<projeto>:latest` |

### 3.2 Ordem recomendada

**1) Banco de dados**
1. Crie o banco `monitoring_system` e o schema: `CREATE SCHEMA monitoring;`
2. Aplique o **schema base** (tabelas `users`, `services`, `service_*`, `deployment_checklist*`).
   > ⚠️ **O dump base (`dump-20251215.sql`) NÃO está nos repositórios.** O schema original era mantido por dump/SQL manual;
   > só duas coisas estão versionadas: a migration `CreateServiceAlerts` (engine) e a de VMs (worker). Ao migrar para
   > portfólio, gere um dump do schema atual (`pg_dump -s -n monitoring`) e versione-o, ou reconstrua a partir das entities TypeORM.
3. Aplique as migrations/SQL:
   - Engine: `pnpm migration:run` (cria `service_alerts`, idempotente).
   - Worker (VMs): `psql ... -f docs/sql/vm-monitoring.sql` **ou** `npm run migration:run`
     (em produção: `docker exec monitoring-system-worker npm run migration:run:prod`). Rollback em `docs/sql/vm-monitoring-rollback.sql`.
   - **O deploy não roda migrations automaticamente.**
4. Crie o usuário admin: `pnpm ts-node scripts/create-admin-user.ts` (engine) **imprime** um `INSERT` para `monitoring.users` com senha `admin123` — execute-o no banco e **troque a senha**. (Atenção: o script gera `INSERT INTO users`; confirme o schema `monitoring.` no seu banco.)
5. Cadastre os serviços a monitorar:
   ```sql
   INSERT INTO monitoring.services (id, name, type, container_id, prometheus_job, loki_label, is_active)
   VALUES ('api-service','API Service','api','api-service-container','api-service','api-service', true);
   ```

**2) `monitoring-system-worker`**
```bash
cd monitoring-system-worker
cp .env.sample .env        # preencha DB_*, DOCKER_SSH_*, ALERT_WEBHOOK_URL
npm install
npm run dev                # ou: npm run build && npm start
```
Mínimo para funcionar: `DB_*` + (`DOCKER_SSH_*` ou socket) + `ALERT_WEBHOOK_URL`.
Para VMs: aplique o SQL de VMs, defina `VM_MONITORING_ENABLED=true` e `MONITOR_HEARTBEAT_TOKEN`, cadastre as VMs em `monitoring.vms`
(`hostname` exatamente igual ao que o agente envia), rode `npm run discover:vms` para descobrir o `provider_id`, e instale o agente em cada VM (`agent/README.md`).
Firewall: restrinja a porta 5080 à rede das VMs.

**3) `monitoring-system-engine`**
```bash
cd monitoring-system-engine
cp .env.sample .env        # preencha DATABASE_*, JWT_SECRET, LOKI_URL, DOCKER_SSH_*
pnpm install
pnpm start:dev             # Swagger: http://localhost:<PORT>/api/docs
```
Teste: `POST /api/v1/auth/login` com o admin criado.

**4) `monitoring-system-dashboard`**
```bash
cd monitoring-system-dashboard
cp .env.sample .env        # VITE_API_URL=http://localhost:<porta do engine>/api/v1
pnpm install
pnpm dev
```
`VITE_API_URL` deve apontar para o engine **incluindo** `/api/v1`.

**5) `monitoring-system` (opcional)**
```bash
cd monitoring-system
cp .env.sample .env        # LOKI_URL, DISCORD_WEBHOOK_URL / MESSAGING_API_URL + EMAIL_*
npm install && npm start
```

### 3.3 Produção (Docker)

Cada projeto tem `Dockerfile` + `docker-compose.yml` (exceto `monitoring-system`, que tem só Dockerfile) e workflow
`.github/workflows/prd.yml`: ao dar push na branch principal (`main`; `master` em `monitoring-system`) o pipeline faz
build → push para GHCR → (runner self-hosted `prod`) baixa os segredos do **Infisical** para `.env` → `docker compose pull/up -d` → apaga o `.env`.

| Projeto | Diretório no servidor | Caminho no Infisical | Mapeamento de porta |
|---|---|---|---|
| worker | `~/Docker/monitoring-system-worker` | `/monitoring-system-worker` | `5080:5080` |
| engine | `~/Docker/monitoring-system-engine` | `/monitoring-system-engine` | `5070:3003` |
| dashboard | `~/Docker/monitoring-system-dashboard` | `/monitoring-system-dashboard` | `5068:3000` |
| monitoring-system | `~/Docker/monitoring-system` | `/monitoring-system` | — |

Segredos necessários no GitHub: `INFISICAL_TOKEN`, `INFISICAL_PROJECT_ID`. Em produção o `.env` é a única fonte de configuração; os `.env.sample` documentam as chaves.

> **Armadilha de porta do engine:** o compose mapeia `5070:3003`, então o container precisa de `PORT=3003`
> (o default do código é 5070 e o Dockerfile faz `EXPOSE 5070`). Sem esse ajuste, a porta publicada não responde.

---

## 4. Variáveis de ambiente (resumo)

Os arquivos `.env.sample` de cada projeto são a referência completa e comentada.

| Projeto | Arquivo | Críticas |
|---|---|---|
| worker | `monitoring-system-worker/.env.sample` | `DB_*`, `DOCKER_SSH_*`, `ALERT_WEBHOOK_URL`, `MONITOR_HEARTBEAT_TOKEN` (se VMs) |
| engine | `monitoring-system-engine/.env.sample` | `DATABASE_*`, `JWT_SECRET`, `LOKI_URL`, `DOCKER_SSH_*` |
| dashboard | `monitoring-system-dashboard/.env.sample` (já existia) | `VITE_API_URL` |
| monitoring-system | `monitoring-system/.env.sample` | `LOKI_URL`, `DISCORD_WEBHOOK_URL`, `MESSAGING_API_URL`, `EMAIL_*` |

Nomes diferentes para o mesmo banco: worker usa `DB_HOST/DB_USERNAME/...`; engine usa `DATABASE_HOST/DATABASE_USERNAME/...`.
Os limiares de disco/heartbeat existem nos dois (`DISK_*`, `HEARTBEAT_MAX_AGE_MINUTES`) e **devem ter os mesmos valores**.

---

## 5. Atenção ao transformar em portfólio

Itens encontrados no código/config que **não devem ir para um repositório público como estão**:

- **Segredos e infraestrutura interna:** IPs `10.10.10.223/224`, organização `agroplay-music-ltda` (imagens GHCR), domínio do Infisical (`http://10.10.10.223:6007/api`), caminho `/home/desenvol_prod/...`, nome de sistema `Paralogy` e a lista de serviços internos em `monitoring-system/worker-monitor.js`. Troque por placeholders.
- **Credenciais padrão:** usuários `admin`/`operator`/`viewer` com senha `admin123` (README do engine e `create-admin-user.ts`).
- **Histórico git:** `monitoring-system-worker` tem `.git` com histórico completo; use repositório novo (sem histórico) ou limpe antes de publicar. Verifique se nenhum commit antigo contém `.env`/senhas.
- **Segurança a conhecer/documentar:** CORS aberto a qualquer origem nos dois servidores; heartbeat com token global por HTTP; `DOCKER_SSH_PASSWORD` em texto no `.env`.
- **Schema base ausente** (ver 3.2) — sem ele ninguém consegue subir o projeto a partir do repositório.
- **Resíduos:** `ManusDialog.tsx` e `Map.tsx` no dashboard (vindos de template), `ideas.md`, `docs/comofunciona.md` com diagrama defasado (fala em `*/15`, mas o código roda por `CRON_EXPRESSION`), duas listas duplicadas (`paralogy-distribution` aparece 2× em `DEFAULT_SERVICES`).
- **Divergências de nome/porta:** `.env.example` do engine e do worker coexistem com os novos `.env.sample`; escolha um nome e remova o outro (não removi nada — ver abaixo).
