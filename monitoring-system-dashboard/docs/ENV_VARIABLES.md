# 🔐 Variáveis de Ambiente - Runtime Injection

## Como Funciona

Este projeto usa **injeção runtime** de variáveis de ambiente, permitindo que a mesma imagem Docker seja configurada via variáveis de ambiente sem precisar rebuild.

### Fluxo

1. **Build Time**: A imagem é buildada sem variáveis hardcoded
2. **Runtime**: O servidor Node.js injeta as variáveis no HTML via `window.__ENV__`
3. **Client**: O código React lê as variáveis de `window.__ENV__` primeiro, depois de `import.meta.env` (fallback para dev)

## Variáveis Disponíveis

Todas as variáveis devem usar o prefixo `VITE_` no `.env`:

```bash
# API Configuration
VITE_API_URL=http://your-engine-host:5070/api/v1

# App Configuration  
VITE_APP_TITLE=Monitoring System Dashboard
VITE_APP_LOGO=/logo.svg

# Analytics (Optional)
VITE_ANALYTICS_ENDPOINT=
VITE_ANALYTICS_WEBSITE_ID=
```

## Arquitetura

### Server (`server/index.ts`)

O servidor injeta as variáveis no HTML automaticamente:

```typescript
const getEnvScript = () => {
  const env = {
    API_URL: process.env.VITE_API_URL || 'http://localhost:3001/api/v1',
    APP_TITLE: process.env.VITE_APP_TITLE || 'Monitoring System Dashboard',
    // ... outras variáveis
  };
  return `<script>window.__ENV__ = ${JSON.stringify(env)};</script>`;
};
```

### Client (`client/src/lib/env.ts`)

Helper centralizado para acessar as variáveis:

```typescript
import { getEnv } from '@/lib/env';

const env = getEnv();
console.log(env.API_URL); // Prioridade: window.__ENV__ > import.meta.env > fallback
```

## Deploy

O workflow agora está simplificado:

1. **Build & Push**: Imagem buildada e enviada para GHCR (sem variáveis hardcoded)
2. **Deploy**: 
   - Baixa variáveis do Infisical para `.env`
   - Pull da imagem do GHCR
   - Docker Compose sobe o container com variáveis do `.env`
   - Container injeta as variáveis no HTML em runtime

## Vantagens

✅ **Uma única imagem** para todos os ambientes  
✅ **Variáveis centralizadas** no Infisical  
✅ **Sem rebuild** necessário no servidor  
✅ **Workflow limpo** e simples  
✅ **Hot-swap** de configurações (restart do container)

## Desenvolvimento Local

```bash
# 1. Copiar .env.sample
cp .env.sample .env

# 2. Ajustar variáveis
vim .env

# 3. Rodar dev server
pnpm dev
```

No modo dev, o Vite usa `import.meta.env.VITE_*` diretamente do `.env`.
