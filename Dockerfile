FROM node:22-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ .
RUN npm run build

FROM node:22-slim AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm install
COPY backend/ .
RUN npm run build

FROM node:22-slim
WORKDIR /app

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code@2.1.50

# Create directory for Claude config and credentials
RUN mkdir -p /home/node/.claude && chown -R node:node /home/node

COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/package.json ./
COPY --from=backend-build /app/backend/package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=frontend-build /app/frontend/dist ./public

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV RALPH_DOCKER=1

RUN chown -R node:node /app
EXPOSE 3001
USER node
CMD ["node", "dist/index.js"]
