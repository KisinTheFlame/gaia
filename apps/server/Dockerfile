FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /app
ENV DATABASE_URL="postgresql://gaia:gaia@localhost:5432/gaia?schema=public"

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json .npmrc ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/client/package.json packages/client/package.json

RUN pnpm install --frozen-lockfile

COPY apps/server ./apps/server
COPY packages/shared ./packages/shared
COPY packages/client ./packages/client

RUN pnpm --filter @kisinwen/gaia-shared build
RUN pnpm --filter @kisinwen/gaia-server build
RUN pnpm --filter @kisinwen/gaia-server deploy --prod --legacy /prod/server
RUN cd /prod/server && node node_modules/prisma/build/index.js generate --schema prisma/schema.prisma

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV="production"
ENV PORT=20005

COPY --from=build /prod/server ./

EXPOSE 20005
CMD ["node", "dist/index.js"]
