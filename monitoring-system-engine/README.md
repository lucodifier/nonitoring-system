# Monitoring System Engine (Backend)

Backend API desenvolvida em **NestJS** para o sistema de monitoramento de serviços. Esta API fornece endpoints para gerenciamento de serviços, métricas, alertas e checklist de deployment.

## 🚀 Tecnologias

- **NestJS** 10.x - Framework Node.js
- **TypeORM** 0.3.x - ORM para PostgreSQL
- **PostgreSQL** 12+ - Banco de dados
- **JWT** - Autenticação
- **Swagger** - Documentação da API
- **TypeScript** - Linguagem

## 📋 Pré-requisitos

- Node.js 18+ e pnpm
- PostgreSQL 12+
- Banco de dados configurado (execute os scripts SQL primeiro)

## 🔧 Instalação

### 1. Instalar dependências

```bash
pnpm install
```

### 2. Configurar variáveis de ambiente

Copie o arquivo `.env.example` para `.env` e configure:

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas configurações:

```env
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=sua_senha
DATABASE_NAME=monitoring_system

# JWT
JWT_SECRET=sua-chave-secreta-aqui

# Application
PORT=3000
```

### 3. Executar o servidor

**Modo desenvolvimento:**
```bash
pnpm start:dev
```

**Modo produção:**
```bash
pnpm build
pnpm start:prod
```

## 📚 Documentação da API

Após iniciar o servidor, acesse a documentação Swagger em:

```
http://localhost:3000/api/docs
```

## 🔐 Autenticação

A API utiliza JWT (JSON Web Tokens) para autenticação. Para acessar os endpoints protegidos:

1. Faça login através do endpoint `POST /api/v1/auth/login`
2. Copie o `access_token` retornado
3. No Swagger, clique em "Authorize" e cole o token
4. Ou adicione o header: `Authorization: Bearer {seu_token}`

### Usuários padrão (após executar seed data):

- **Username:** `admin` | **Password:** `admin123`
- **Username:** `operator` | **Password:** `admin123`
- **Username:** `viewer` | **Password:** `admin123`

## 📡 Endpoints Principais

### Autenticação
- `POST /api/v1/auth/login` - Login
- `GET /api/v1/auth/me` - Perfil do usuário
- `POST /api/v1/auth/logout` - Logout

### Services
- `GET /api/v1/services` - Listar todos os serviços
- `GET /api/v1/services/:id` - Detalhes de um serviço
- `GET /api/v1/services/:id/status` - Status atual
- `GET /api/v1/services/:id/history` - Histórico de status
- `GET /api/v1/services/:id/errors` - Erros do serviço
- `GET /api/v1/services/:id/alerts` - Alertas do serviço

### Metrics
- `GET /api/v1/metrics/dashboard-summary` - Resumo do dashboard
- `GET /api/v1/metrics/cpu/:serviceId` - Métricas de CPU
- `GET /api/v1/metrics/memory/:serviceId` - Métricas de memória
- `GET /api/v1/metrics/errors-per-minute` - Erros por minuto
- `GET /api/v1/metrics/uptime/:serviceId` - Uptime do serviço

### Alerts
- `GET /api/v1/alerts` - Listar alertas
- `PATCH /api/v1/alerts/:id/resolve` - Resolver alerta
- `PATCH /api/v1/alerts/:id/acknowledge` - Reconhecer alerta

### Errors
- `GET /api/v1/errors/latest` - Últimos erros

### Deployment
- `GET /api/v1/deployment/checklist` - Checklist de deployment
- `GET /api/v1/deployment/status` - Status de prontidão
- `PATCH /api/v1/deployment/checklist/:id` - Atualizar item

## 🗂️ Estrutura do Projeto

```
src/
├── auth/                 # Módulo de autenticação
│   ├── dto/             # DTOs de autenticação
│   ├── guards/          # Guards JWT e Local
│   ├── strategies/      # Estratégias Passport
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   └── auth.module.ts
├── identities/          # Módulo de usuários
│   ├── entities/
│   ├── identities.service.ts
│   └── identities.module.ts
├── services/            # Módulo de serviços
│   ├── entities/        # Entidades TypeORM
│   ├── services.controller.ts
│   ├── services.service.ts
│   └── services.module.ts
├── metrics/             # Módulo de métricas
│   ├── metrics.controller.ts
│   ├── metrics.service.ts
│   └── metrics.module.ts
├── alerts/              # Módulo de alertas
│   ├── alerts.controller.ts
│   └── alerts.module.ts
├── errors/              # Módulo de erros
│   ├── errors.controller.ts
│   └── errors.module.ts
├── deployment/          # Módulo de deployment
│   ├── entities/
│   ├── dto/
│   ├── deployment.controller.ts
│   ├── deployment.service.ts
│   └── deployment.module.ts
├── app.module.ts        # Módulo principal
└── main.ts              # Entry point
```

## 🔍 Entidades do Banco de Dados

O projeto utiliza as seguintes entidades TypeORM:

- **Identity** - Usuários do sistema (tabela `identities`)
- **Service** - Serviços monitorados
- **ServiceStatusCurrent** - Status atual dos serviços
- **ServiceStatusHistory** - Histórico de status
- **ServiceError** - Erros capturados
- **ServiceAlert** - Alertas gerados
- **DeploymentChecklist** - Itens do checklist
- **DeploymentChecklistStatus** - Status dos itens

## 🧪 Testes

```bash
# Testes unitários
pnpm test

# Testes e2e
pnpm test:e2e

# Coverage
pnpm test:cov
```

## 🛠️ Scripts Disponíveis

```bash
pnpm start          # Inicia em modo normal
pnpm start:dev      # Inicia em modo watch
pnpm start:prod     # Inicia em modo produção
pnpm build          # Compila o projeto
pnpm lint           # Executa o linter
pnpm format         # Formata o código
```

## 🔒 Segurança

- Senhas são hasheadas com bcrypt (10 rounds)
- JWT com expiração configurável
- Validação de entrada em todos os endpoints
- CORS configurável
- Guards para proteção de rotas

## 📊 Performance

- Índices otimizados no banco de dados
- Queries com joins eficientes
- Paginação em listas grandes
- Cache de configurações

## 🐛 Troubleshooting

### Erro de conexão com o banco

Verifique se:
1. PostgreSQL está rodando
2. Credenciais no `.env` estão corretas
3. Banco de dados `monitoring_system` existe
4. Scripts SQL foram executados

### Erro de autenticação

Verifique se:
1. `JWT_SECRET` está configurado no `.env`
2. Token não está expirado
3. Header `Authorization` está correto

## 📝 Licença

MIT

## 👥 Autores

Monitoring Team
