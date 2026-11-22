# Monitoring Worker

A worker that checks Loki logs every 15 minutes for errors across multiple services. When alerts are detected, it sends notifications to Discord and email.

## Requirements
- Node.js 18+
- Access to Loki (and optional Grafana for links)

## Setup
1. Copy `.env.example` to `.env` and fill in values:
```bash
cp .env.example .env
```

2. Install dependencies:
```bash
npm install
```

## Environment Variables
See `.env.example` for full list. Key variables:
- `LOKI_URL`: Loki base URL
- `GRAFANA_URL`: Grafana base URL (for Explore links)
- `SERVICES`: Comma-separated list (≥18) to override defaults
- `DISCORD_WEBHOOK_URL`: Discord webhook for alerts
- `MESSAGING_API_URL`: External messaging API base URL
- `EMAIL_FROM`, `EMAIL_TO` (comma-separated)

## Run
- One-off run (will also schedule every 15 minutes):
```bash
npm start
```

## Notes
- Uses ESM (`type: module`).
- Schedule: `*/15 * * * *` (every 15 minutes).
- Loki query: `{service="<name>"} |~ "(?i)(error|exception|fatal|critical)"`.
- Email is sent via external messaging API using payload `{ system, subjectCode, notificationType, recipients, metadata }`.
