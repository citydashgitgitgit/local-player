FROM node:20.18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk update && \
    apk add --no-cache libc6-compat git
WORKDIR /app

COPY package.json package-lock.json ./
RUN yarn install --frozen-lockfile --network-timeout 60000 --network-concurrency 1 --prefer-offline

FROM base AS dev
WORKDIR /opt/local-player

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV development
EXPOSE 3000
ENV PORT 3000

ENV HOSTNAME "0.0.0.0"

CMD ["npm", "run", "dev"]

