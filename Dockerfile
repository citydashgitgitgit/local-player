FROM node:20.18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk update && \
    apk add --no-cache libc6-compat git
WORKDIR /app

COPY package.json package-lock.json ./
RUN yarn install --frozen-lockfile --network-timeout 60000 --network-concurrency 1 --prefer-offline

FROM base AS builder
WORKDIR /app
ENV NODE_ENV development

COPY --from=deps /app/node_modules ./node_modules
COPY next.config.ts .
COPY package.json .
COPY src ./src
COPY public ./public
COPY .env.example .env
COPY . ./

RUN yarn build
RUN rm -rf .next/cache

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app
ENV NODE_ENV development

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir .next && \
    chown nextjs:nodejs .next

# Copy only necessary files from builder
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/.env ./.env

USER nextjs

EXPOSE 3000
ENV PORT 3000
# set hostname to localhost
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]

