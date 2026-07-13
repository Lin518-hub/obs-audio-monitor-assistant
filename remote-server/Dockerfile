FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public

ENV NODE_ENV=production PORT=8088 DATA_DIR=/data UPDATE_DIR=/updates
USER node
EXPOSE 8088
CMD ["node", "src/server.mjs"]
