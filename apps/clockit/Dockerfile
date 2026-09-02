# ClockIT API container. Runs the TypeScript API with tsx against the shared
# PostgreSQL/Redis/MailHog services from the root docker-compose.yml.
FROM node:20-alpine
# Prisma's query/schema engines need OpenSSL on Alpine
# RUN apk add --no-cache openssl libc6-compat
RUN apk add --no-cache openssl libc6-compat python3 make g++
WORKDIR /clockit
COPY package*.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm install --no-audit --no-fund
COPY apps/api apps/api
RUN cd apps/api && npx prisma generate
EXPOSE 3000
# prisma migrate deploy is idempotent — keeps the schema current on start
CMD ["sh", "-c", "cd apps/api && npx prisma migrate deploy && npx tsx src/index.ts"]
