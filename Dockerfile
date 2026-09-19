FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5173 GARDEN_DATA=/var/lib/rainholm
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node . .
RUN mkdir -p /var/lib/rainholm && chown node:node /var/lib/rainholm
USER node
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/serve.mjs"]
