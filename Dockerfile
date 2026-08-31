FROM node:24-alpine AS build
WORKDIR /app
COPY package.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm install --no-audit --no-fund
COPY client client
RUN npm run build --workspace client

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/
RUN cd server && npm install --omit=dev --no-audit --no-fund
COPY server server
COPY --from=build /app/client/dist client/dist
ENV PORT=5191
ENV DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 5191
USER node
CMD ["node", "server/index.js"]
