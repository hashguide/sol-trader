FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir -p /app/research-candles && cp -a data/candles/. /app/research-candles/

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV ENGINE_BIND=127.0.0.1
ENV WEB_BIND=0.0.0.0
ENV ENGINE_PORT=4471
ENV WEB_PORT=4472
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./
COPY --from=build /app/research-candles ./research-candles
VOLUME /app/data
EXPOSE 4472
CMD ["node", "dist/docker-entry.js"]
