# Build: compile the TypeScript with rollup
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
# Settings come from the environment at runtime (example.config.ts reads them); a local
# config.ts with real secrets is excluded by .dockerignore and never baked into the image
RUN cp src/example.config.ts src/config.ts && yarn build

# Run: production dependencies and the compiled output only
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean
COPY --from=build /app/dist ./dist
RUN mkdir logs && chown node:node logs
USER node
EXPOSE 3100
CMD ["node", "dist/index.js"]
