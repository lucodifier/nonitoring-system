# API Endpoints - Monitoring System Engine

## Base URL

```
http://localhost:3000/api/v1
```
## Autenticação

Todos os endpoints (exceto `/auth/login`) requerem autenticação via JWT Bearer Token.

**Header:**
```
Authorization: Bearer {seu_token_jwt}
```

---

## 🔐 Authentication

### POST /auth/login
Login com usuário e senha.

**Request Body:**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "username": "admin",
    "email": "admin@monitoring.local",
    "fullName": "Administrator"
  }
}
```

### GET /auth/me
Retorna o perfil do usuário autenticado.

**Response:**
```json
{
  "id": 1,
  "username": "admin",
  "email": "admin@monitoring.local",
  "fullName": "Administrator",
  "isActive": true,
  "lastLogin": "2025-11-30T10:30:00Z"
}
```

### POST /auth/logout
Logout do usuário.

**Response:**
```json
{
  "message": "Logout successful"
}
```

---

## 🔧 Services

### GET /services
Lista todos os serviços.

**Query Parameters:**
- `type` (optional): Filtrar por tipo (api, worker, database, website)
- `env` (optional): Filtrar por ambiente (production, staging, development)
- `isActive` (optional): Filtrar por status ativo (true/false)

**Response:**
```json
[
  {
    "id": "paralogy-api",
    "name": "Paralogy API",
    "type": "api",
    "env": "production",
    "importance": "critical",
    "currentStatus": {
      "status": "UP",
      "cpuUsage": 45.2,
      "memoryUsage": 62.8,
      "errorCount": 0
    }
  }
]
```

### GET /services/:id
Retorna detalhes de um serviço específico.

**Response:**
```json
{
  "id": "paralogy-api",
  "name": "Paralogy API",
  "description": "API principal do sistema Paralogy",
  "type": "api",
  "env": "production",
  "url": "https://api.paralogy.com",
  "prometheusJob": "paralogy-api",
  "lokiLabel": "app=\"paralogy-api\"",
  "importance": "critical",
  "team": "backend",
  "currentStatus": {
    "status": "UP",
    "cpuUsage": 45.2,
    "memoryUsage": 62.8,
    "errorCount": 0,
    "lastCheck": "2025-11-30T10:30:00Z"
  }
}
```

### GET /services/:id/status
Retorna o status atual de um serviço.

**Response:**
```json
{
  "serviceId": "paralogy-api",
  "status": "UP",
  "cpuUsage": 45.2,
  "memoryUsage": 62.8,
  "diskUsage": 35.1,
  "errorCount": 0,
  "warningCount": 0,
  "restartCount": 0,
  "lastCheck": "2025-11-30T10:30:00Z",
  "lastChange": "2025-11-30T08:00:00Z"
}
```

### GET /services/:id/history
Retorna o histórico de status de um serviço.

**Query Parameters:**
- `startDate` (optional): Data inicial (ISO 8601)
- `endDate` (optional): Data final (ISO 8601)
- `limit` (optional): Limite de registros (default: 1000)

**Response:**
```json
[
  {
    "id": "12345",
    "serviceId": "paralogy-api",
    "status": "UP",
    "cpuUsage": 45.2,
    "memoryUsage": 62.8,
    "checkedAt": "2025-11-30T10:30:00Z"
  }
]
```

### GET /services/:id/errors
Retorna os erros de um serviço.

**Query Parameters:**
- `limit` (optional): Limite de registros (default: 10)
- `isResolved` (optional): Filtrar por resolvidos (true/false)

**Response:**
```json
[
  {
    "id": "1",
    "serviceId": "paralogy-api",
    "errorMessage": "Database connection timeout",
    "errorType": "DatabaseError",
    "errorLevel": "error",
    "lokiUrl": "https://grafana.local/explore?query=...",
    "isResolved": false,
    "occurredAt": "2025-11-30T08:15:00Z"
  }
]
```

### GET /services/:id/alerts
Retorna os alertas de um serviço.

**Query Parameters:**
- `resolved` (optional): Filtrar por resolvidos (true/false)
- `limit` (optional): Limite de registros (default: 50)

**Response:**
```json
[
  {
    "id": "1",
    "serviceId": "paralogy-api",
    "alertType": "high_cpu",
    "severity": "warning",
    "title": "High CPU Usage",
    "message": "CPU usage is 95.2% (threshold: 90%)",
    "resolved": false,
    "createdAt": "2025-11-30T09:00:00Z"
  }
]
```

---

## 📊 Metrics

### GET /metrics/dashboard-summary
Retorna um resumo consolidado para o dashboard principal.

**Response:**
```json
{
  "services": {
    "total": 12,
    "up": 10,
    "down": 1,
    "degraded": 1
  },
  "alerts": {
    "unresolved": 3,
    "critical": 1
  },
  "latestErrors": [
    {
      "id": "1",
      "serviceId": "paralogy-api",
      "errorMessage": "Database connection timeout",
      "occurredAt": "2025-11-30T08:15:00Z"
    }
  ]
}
```

### GET /metrics/cpu/:serviceId
Retorna métricas de CPU de um serviço.

**Query Parameters:**
- `hours` (optional): Período em horas (default: 24)

**Response:**
```json
{
  "serviceId": "paralogy-api",
  "metric": "cpu_usage",
  "unit": "percent",
  "data": [
    {
      "timestamp": "2025-11-30T10:00:00Z",
      "value": 45.2
    },
    {
      "timestamp": "2025-11-30T10:05:00Z",
      "value": 47.8
    }
  ]
}
```

### GET /metrics/memory/:serviceId
Retorna métricas de memória de um serviço.

**Query Parameters:**
- `hours` (optional): Período em horas (default: 24)

**Response:** Similar ao endpoint de CPU.

### GET /metrics/errors-per-minute
Retorna a taxa de erros por minuto.

**Query Parameters:**
- `serviceId` (optional): ID do serviço (se omitido, retorna para todos)
- `minutes` (optional): Período em minutos (default: 60)

**Response:**
```json
{
  "serviceId": "paralogy-api",
  "metric": "errors_per_minute",
  "unit": "count",
  "data": [
    {
      "timestamp": "2025-11-30T10:00:00Z",
      "value": 3
    },
    {
      "timestamp": "2025-11-30T10:01:00Z",
      "value": 5
    }
  ]
}
```

### GET /metrics/uptime/:serviceId
Retorna o percentual de uptime de um serviço.

**Query Parameters:**
- `hours` (optional): Período em horas (default: 24)

**Response:**
```json
{
  "serviceId": "paralogy-api",
  "hours": 24,
  "total": 288,
  "upCount": 285,
  "uptimePercentage": 98.96
}
```

---

## 🚨 Alerts

### GET /alerts
Lista todos os alertas.

**Query Parameters:**
- `resolved` (optional): Filtrar por resolvidos (true/false)
- `limit` (optional): Limite de registros (default: 100)

**Response:**
```json
[
  {
    "id": "1",
    "serviceId": "paralogy-api",
    "alertType": "high_cpu",
    "severity": "warning",
    "title": "High CPU Usage",
    "message": "CPU usage is 95.2% (threshold: 90%)",
    "resolved": false,
    "acknowledged": false,
    "createdAt": "2025-11-30T09:00:00Z",
    "service": {
      "id": "paralogy-api",
      "name": "Paralogy API"
    }
  }
]
```

### PATCH /alerts/:id/resolve
Resolve um alerta.

**Response:**
```json
{
  "id": "1",
  "resolved": true,
  "resolvedAt": "2025-11-30T10:30:00Z",
  "resolvedBy": "admin"
}
```

### PATCH /alerts/:id/acknowledge
Reconhece um alerta.

**Response:**
```json
{
  "id": "1",
  "acknowledged": true,
  "acknowledgedAt": "2025-11-30T10:30:00Z",
  "acknowledgedBy": "admin"
}
```

---

## ❌ Errors

### GET /errors/latest
Retorna os últimos erros de todos os serviços.

**Query Parameters:**
- `limit` (optional): Limite de registros (default: 10)

**Response:**
```json
[
  {
    "id": "1",
    "serviceId": "paralogy-api",
    "errorMessage": "Database connection timeout",
    "errorType": "DatabaseError",
    "errorLevel": "error",
    "lokiUrl": "https://grafana.local/explore?query=...",
    "occurredAt": "2025-11-30T08:15:00Z",
    "service": {
      "id": "paralogy-api",
      "name": "Paralogy API"
    }
  }
]
```

---

## 🚀 Deployment

### GET /deployment/checklist
Retorna o checklist de deployment.

**Query Parameters:**
- `category` (optional): Filtrar por categoria

**Response:**
```json
[
  {
    "id": 1,
    "itemName": "Load Balancer Configured",
    "description": "Verificar se o load balancer está configurado corretamente",
    "category": "infrastructure",
    "priority": 10,
    "isRequired": true,
    "latestStatus": {
      "status": true,
      "checkedBy": "admin",
      "checkedAt": "2025-11-30T08:00:00Z"
    }
  }
]
```

### GET /deployment/status
Retorna o status consolidado de prontidão para deployment.

**Response:**
```json
{
  "readyForDeployment": true,
  "totalItems": 20,
  "completedItems": 18,
  "requiredItems": 15,
  "completedRequiredItems": 15,
  "completionPercentage": 90.0,
  "itemsByCategory": [
    {
      "category": "infrastructure",
      "total": 5,
      "completed": 5,
      "items": [...]
    }
  ]
}
```

### PATCH /deployment/checklist/:id
Atualiza o status de um item do checklist.

**Request Body:**
```json
{
  "status": true,
  "checkedBy": "admin",
  "notes": "Verified all configurations",
  "evidenceUrl": "https://example.com/evidence.png"
}
```

**Response:**
```json
{
  "id": 1,
  "checklistItemId": 1,
  "status": true,
  "checkedBy": "admin",
  "notes": "Verified all configurations",
  "checkedAt": "2025-11-30T10:30:00Z"
}
```

---

## 📝 Códigos de Status HTTP

- `200 OK` - Requisição bem-sucedida
- `201 Created` - Recurso criado com sucesso
- `400 Bad Request` - Dados inválidos
- `401 Unauthorized` - Não autenticado
- `403 Forbidden` - Sem permissão
- `404 Not Found` - Recurso não encontrado
- `500 Internal Server Error` - Erro no servidor

---

## 🔍 Filtros e Paginação

A maioria dos endpoints de listagem suporta:

- **Filtros**: Query parameters específicos para cada endpoint
- **Limite**: `limit` parameter para controlar quantidade de resultros
- **Ordenação**: Geralmente por data decrescente (mais recente primeiro)

---

## 🧪 Testando a API

### Usando cURL

```bash
# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Listar serviços (com token)
curl -X GET http://localhost:3000/api/v1/services \
  -H "Authorization: Bearer {seu_token}"
```

### Usando Swagger

Acesse `http://localhost:3000/api/docs` e use a interface interativa.