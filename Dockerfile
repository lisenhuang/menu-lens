FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app
COPY --chown=node:node server.mjs providers.mjs admin.mjs usage.mjs storage.mjs migrate.mjs ./
COPY --chown=node:node public/menu-view.js public/icons.js ./public/
USER node
ENV HOST=0.0.0.0 PORT=8080 DATA_DIR=/data NODE_ENV=production
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
