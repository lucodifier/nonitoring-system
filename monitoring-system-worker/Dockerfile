# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY tsconfig.json ./

RUN npm install && npm cache clean --force

COPY src ./src

RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS prod

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

CMD ["node", "dist/index.js"]
