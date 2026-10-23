FROM node:20-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production PORT=8080 DATA_FILE=/data/state.json
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "server/index.js"]
