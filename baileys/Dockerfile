FROM node:24-alpine
RUN apk add --no-cache git
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY *.mjs ./
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=9322 DATA_DIR=/data
EXPOSE 9322
HEALTHCHECK --interval=15s --timeout=4s CMD node -e "fetch('http://127.0.0.1:9322/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server.mjs"]
