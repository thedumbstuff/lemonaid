# Lemonaid in a container.
#
#   docker build -t lemonaid .
#   docker run -p 3000:3000 -v lemonaid-data:/data \
#     -e OWNER_EMAIL=you@yourdomain.com -e PUBLIC_URL=https://board.yourdomain.com \
#     -e SECRETS_FILE=/run/secrets/lemonaid.json -v /path/to/lemonaid.json:/run/secrets/lemonaid.json:ro \
#     lemonaid
#
# Online settings by default (NODE_ENV=production: no test mailbox, no demo owner). The
# database and pictures live in /data: keep it on a volume. It runs as user 10001 and does
# not need to write anywhere else, so the container can run with a read-only file system.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY public ./public
COPY LICENSE README.md ./

RUN adduser -D -H -u 10001 lemonaid && mkdir -p /data && chown lemonaid /data
USER 10001
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/board/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "--no-warnings", "src/index.js"]
