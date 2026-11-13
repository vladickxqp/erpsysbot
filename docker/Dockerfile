# The app as one small image: Next.js standalone server plus the database
# migrations it runs on start (src/instrumentation.ts).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=80
RUN addgroup -S app && adduser -S app -G app
# The video studio puts videos together with ffmpeg (src/server/video.ts).
RUN apk add --no-cache ffmpeg
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/db ./db
COPY --from=build --chown=app:app /app/assets ./assets
# Uploaded documents (a volume in docker-compose.yml).
ENV UPLOAD_DIR=/app/uploads
RUN mkdir -p /app/uploads && chown app:app /app/uploads
USER app
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
