ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS builder

USER root
WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS runner

USER root
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/dist ./dist
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
