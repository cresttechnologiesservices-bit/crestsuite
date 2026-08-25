# CrestSuite portal image: portal + LeaveMS + QMS (in-process) + the built
# ClockIT web app. The ClockIT API runs in its own container (see
# apps/clockit/Dockerfile) and is proxied by this one.

# ---- Stage 1: build the ClockIT web SPA ----
FROM node:20-alpine AS clockit-web
WORKDIR /clockit
COPY apps/clockit/package*.json ./
COPY apps/clockit/apps/api/package.json apps/api/
COPY apps/clockit/apps/web/package.json apps/web/
RUN npm install --no-audit --no-fund
COPY apps/clockit/apps/web apps/web
COPY apps/clockit/apps/api/prisma apps/api/prisma
RUN npm -w apps/web run build

# ---- Stage 2: the portal ----
FROM node:20-alpine
WORKDIR /suite
ENV NODE_ENV=production
COPY package.json ./
COPY portal/package.json portal/
COPY apps/leavems/package.json apps/leavems/
COPY apps/qms/package.json apps/qms/
RUN npm install --omit=dev --no-audit --no-fund
COPY shared shared
COPY portal portal
COPY apps/leavems apps/leavems
COPY apps/qms apps/qms
COPY --from=clockit-web /clockit/apps/web/dist apps/clockit/apps/web/dist
EXPOSE 8080
CMD ["node", "portal/server.js"]
