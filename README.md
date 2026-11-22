# Monitoring System

Plataforma de monitoramento de serviços (containers Docker) e VMs: coleta saúde, logs e métricas,
persiste em PostgreSQL, alerta em Discord / Google Chat e exibe tudo num dashboard em tempo real.

| Projeto | Papel | Stack |
|---|---|---|
| [`monitoring-system-worker`](monitoring-system-worker) | Coletor, alertas e monitoramento preditivo de VMs | Node, TypeScript, TypeORM, cron |
| [`monitoring-system-engine`](monitoring-system-engine) | API REST + WebSocket | NestJS, TypeORM, JWT, Swagger |
| [`monitoring-system-dashboard`](monitoring-system-dashboard) | Interface web | React, Vite, shadcn/ui |
| [`monitoring-system`](monitoring-system) | Alertador de erros via Loki (standalone) | Node ESM |

## Destaques

- Status `UP` / `DOWN` / `DEGRADED` por serviço, sem falso positivo quando o Docker é inalcançável.
- Previsão de disco cheio por regressão linear, com alerta amarelo e vermelho.
- Detecção de VM parada, inacessível ou sem heartbeat, com agentes bash e PowerShell.
- Atualização em tempo real por WebSocket e configuração do front em runtime, sem rebuild.
- Anti-spam de alertas com cooldown persistido no banco.

## Documentação

Arquitetura, função de cada projeto e passo a passo de provisionamento: **[ARQUITETURA.md](ARQUITETURA.md)**.
Cada projeto tem um `.env.sample` com as variáveis comentadas.
