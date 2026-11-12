FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/static ./static
COPY --from=build /app/openapi.json /app/about.md ./
COPY --from=build /app/docker-entrypoint.sh ./

# The optional store clients are installed here so the image can run any store;
# the package itself imports each one lazily, so a bare `npm install` does not.
RUN npm install --no-save @google-cloud/datastore mongodb memcached redis aws-sdk rethinkdbdash

ENV STORAGE_TYPE=memcached \
    STORAGE_HOST=127.0.0.1 \
    STORAGE_PORT=11211 \
    STORAGE_EXPIRE_SECONDS=2592000 \
    STORAGE_DB=2 \
    STORAGE_AWS_BUCKET= \
    STORAGE_AWS_REGION= \
    STORAGE_FILEPATH= \
    DATABASE_URL=

ENV LOGGING_LEVEL=verbose \
    LOGGING_TYPE=Console \
    LOGGING_COLORIZE=true

ENV HOST=0.0.0.0 \
    PORT=7777 \
    KEY_LENGTH=10 \
    MAX_LENGTH=400000 \
    STATIC_MAX_AGE=86400

ENV KEYGENERATOR_TYPE=phonetic \
    KEYGENERATOR_KEYSPACE=

ENV RATELIMITS_NORMAL_TOTAL_REQUESTS=500 \
    RATELIMITS_NORMAL_EVERY_MILLISECONDS=60000 \
    RATELIMITS_WHITELIST=example1.whitelist,example2.whitelist \
    RATELIMITS_BLACKLIST=example1.blacklist,example2.blacklist
ENV DOCUMENTS=about=./about.md

# The file store writes ./data and the legacy entrypoint writes ./config.js, so
# the working directory belongs to the runtime user.
#
# The recommended deployment is configuration as a mounted file
# (HASTE_CONFIG=/etc/haste/config.json) with secrets as mounted files
# (HASTE_STORAGE__PASSWORD_FILE=/run/secrets/...), which needs no writable
# working directory at all. HASTE_ENTRYPOINT_CONFIG=false disables the config
# generation this image performs for its documented STORAGE_* variables.
RUN chown -R node:node /app
USER node
EXPOSE 7777
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:7777/healthz >/dev/null || exit 1
ENTRYPOINT ["sh", "docker-entrypoint.sh"]
# `serve`, not `start`: the image prunes devDependencies, so `start`'s prestart
# build would find no `tsc`. The build happened in the build stage.
CMD ["npm", "run", "serve"]
