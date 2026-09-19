FROM node:22-bookworm-slim

WORKDIR /app

# Copy manifests first so dependency installation remains cacheable.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/anchor/package.json packages/anchor/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/postgres/package.json packages/postgres/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/secure-signer/package.json packages/secure-signer/package.json
COPY packages/stellar/package.json packages/stellar/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN npm ci --ignore-scripts

COPY . .

ENV NODE_ENV=production

# Render's API service overrides this with its own start command. Keeping a
# useful default makes the image straightforward to run locally as well.
CMD ["npm", "run", "start", "--workspace", "@rosapay/api"]
