# Backend API image (Fly.io). The frontend is built and hosted separately.
# Secrets are never copied in (see .dockerignore); set them on the host with `fly secrets set`.

FROM node:20-alpine

WORKDIR /app

# Install exactly what package-lock.json pins; fail the build if the lockfile is out of date
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

# The app listens on 3001 (fly.toml internal_port)
EXPOSE 3001

# Run as the unprivileged node user, not root
USER node

CMD ["node", "safaricom.js"]
