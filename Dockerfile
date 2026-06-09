# Single image, two entrypoints (bot, cron) selected via compose `command`.
# Bun runs the TypeScript directly — no build/transpile step.
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# Install only production deps into a cache layer keyed on the manifests.
FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Final image: prod node_modules + source. No default CMD — compose picks the
# entrypoint per service (bun run bot / cron / migrate).
FROM base AS release
ENV NODE_ENV=production
COPY --from=install /usr/src/app/node_modules node_modules
COPY package.json bun.lock ./
COPY src ./src
COPY migrations ./migrations
