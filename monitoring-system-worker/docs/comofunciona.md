┌─────────────────────────────────────────────────────────────────┐
│                    MONITORING SYSTEM WORKER                      │
└─────────────────────────────────────────────────────────────────┘

┌─ INICIALIZAÇÃO ─────────────────────────────────────────────────┐
│                                                                   │
│  index.ts → Conecta ao banco de dados (PostgreSQL)              │
│          → Executa processServices() imediatamente              │
│          → Agenda execução periódica via CRON (conforme CRON_EXPRESSION; default: */15 * * * *) │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─ COLETA DE DADOS ───────────────────────────────────────────────┐
│                                                                   │
│  Para cada serviço ativo em monitoring.services:                 │
│                                                                   │
│  ┌─────────────────────┐      ┌──────────────────────┐          │
│  │   PROMETHEUS API    │      │     LOKI API         │          │
│  │                     │      │                      │          │
│  │ • up (status)       │      │ • errorCount         │          │
│  │ • cpu (%)           │      │ (últimos 15 min)     │          │
│  │ • memory (MB)       │      │                      │          │
│  └────────────┬────────┘      └──────────────┬───────┘          │
│               │                              │                   │
│               └──────────────┬───────────────┘                   │
│                              ↓                                   │
│                    Métricas Coletadas                            │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─ CÁLCULO DE STATUS ─────────────────────────────────────────────┐
│                                                                   │
│  Regras de avaliação:                                            │
│                                                                   │
│  ✓ UP            → se up > 0                                    │
│  ✗ DOWN          → se up == 0                                   │
│  ⚠ DEGRADED      → se errorCount > 10                           │
│                     OU cpu > 80%                                │
│                     OU memory > 500 MB                          │
│                                                                   │
│  Resultado: status + métricas do serviço                        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─ PERSISTÊNCIA NO BANCO ─────────────────────────────────────────┐
│                                                                   │
│  ┌──────────────────────────────┐                               │
│  │ ServiceStatusCurrent (atual) │ ← Último status registrado   │
│  │ • serviceId                  │                               │
│  │ • status (UP/DOWN/DEGRADED)  │                               │
│  │ • metrics (cpu, memory, etc) │                               │
│  │ • lastCheck                  │                               │
│  └──────────────────────────────┘                               │
│                  ↓                                               │
│  ┌──────────────────────────────┐                               │
│  │ ServiceStatusHistory         │ ← Histórico completo         │
│  │ (cada mudança é registrada)  │                               │
│  │ • serviceId                  │                               │
│  │ • status                     │                               │
│  │ • cpu, memory, errorCount    │                               │
│  │ • checkedAt                  │                               │
│  └──────────────────────────────┘                               │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─ GERAÇÃO DE ALERTAS ────────────────────────────────────────────┐
│                                                                   │
│  Verifica: Existe alerta NÃO-RESOLVIDO recente para este        │
│            serviço?                                             │
│                                                                   │
│  ┌─ SIM ──→ Não cria (evita duplicação)                         │
│  │                                                               │
│  └─ NÃO ──→ Cria novo ServiceAlert                              │
│             • serviceId                                         │
│             • alertType (DOWN, DEGRADED, etc)                   │
│             • severity (CRITICAL, WARNING, INFO)                │
│             • message (descrição detalhada)                     │
│             • createdAt                                         │
│             • resolvedAt (null)                                 │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─ NOTIFICAÇÕES EXTERNAS ─────────────────────────────────────────┐
│                                                                   │
│  Se DISCORD_WEBHOOK_URL configurada:                            │
│                                                                   │
│  ┌───────────────────────────────────────────────────────┐      │
│  │ 🔔 DISCORD WEBHOOK                                   │      │
│  │                                                       │      │
│  │ Mensagem:  "[CRITICAL] api-service está DOWN"        │      │
│  │ Severity:  CRITICAL                                  │      │
│  │ Dashboard: https://dashboard.com?from=15m-ago        │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘

┌─ CICLO REPETIDO ────────────────────────────────────────────────┐
│                                                                   │
│  ⏱️  A cada minuto (ou conforme CRON_EXPRESSION):                │
│                                                                   │
│      Coleta → Calcula → Persiste → Alerta → [repete]            │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘