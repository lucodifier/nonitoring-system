FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm build


FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --no-frozen-lockfile
COPY --from=builder /app/dist ./dist

EXPOSE 5070

CMD ["node", "dist/src/main.js"]
