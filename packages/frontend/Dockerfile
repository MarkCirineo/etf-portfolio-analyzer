# Build: the app compiles to static files
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
# Same origin as the page: nginx below passes /api and /socket.io to the backend
ENV VITE_API_URL=/api
RUN yarn build

# Serve: nginx with the files, proxying the API
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
