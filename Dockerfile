# syntax=docker/dockerfile:1.7
FROM node:22-slim AS base
WORKDIR /app

ENV NODE_ENV=production

FROM base AS deps
ENV NODE_ENV=development
RUN corepack enable
COPY package.json yarn.lock ./
COPY prisma ./prisma
RUN yarn install --frozen-lockfile
RUN yarn prisma:generate

FROM deps AS build
ARG BUILD_TIMESTAMP
COPY tsconfig.json ./
COPY src ./src
RUN yarn build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
ARG BUILD_TIMESTAMP
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}
COPY --from=deps /app/node_modules ./node_modules
COPY package.json yarn.lock ./
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
