#!/bin/sh

# Container entrypoint.
#
# Two supported shapes:
#
#  1. Configuration as a mounted file (recommended for Kubernetes/Docker secrets):
#     HASTE_CONFIG=/etc/haste/config.json, secrets mounted as files and read
#     through `<NAME>_FILE`. Set HASTE_ENTRYPOINT_CONFIG=false and nothing is
#     generated.
#
#  2. The image's documented STORAGE_*/LOGGING_*/KEYGENERATOR_*/RATELIMITS_*
#     variables, translated into ./config.js on boot.
#
# Unset (or true) keeps the historical behaviour: generate ./config.js only when
# the operator has not pointed HASTE_CONFIG at their own file.

set -e

if [ "${HASTE_ENTRYPOINT_CONFIG:-true}" != "false" ] && [ -z "${HASTE_CONFIG:-}" ]; then
  node ./dist/docker-entrypoint.js > ./config.js
fi

exec "$@"
