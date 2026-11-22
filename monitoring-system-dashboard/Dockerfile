# Build and serve
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Instalar pnpm — a versão TEM que bater com o campo "packageManager" do package.json.
# Sem o pin, o npm instala o pnpm mais recente; ele lê packageManager: pnpm@10.4.1,
# tenta se auto-gerenciar baixando @pnpm/exe.linux-x64 e falha a verificação com
# ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE, quebrando qualquer build sem que nada
# tenha mudado no repositório. Ao alterar packageManager, altere aqui também.
RUN npm install -g pnpm@10.4.1

# Copiar arquivos necessários para instalação
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

# Instalar dependências
RUN pnpm install --frozen-lockfile

# Copiar resto do projeto
COPY . .

# Build (usa variáveis de ambiente ao lado)
RUN pnpm build

# Remover dev dependencies
RUN pnpm install --frozen-lockfile --prod && pnpm store prune

EXPOSE 3000

CMD ["node", "dist/index.js"]

