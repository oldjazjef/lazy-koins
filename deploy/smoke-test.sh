#!/usr/bin/env bash
# Checks a deployed environment: the API answers through the web container, and the app loads.
# Usage: LAZYKOINS_SITE_URL=https://… deploy/smoke-test.sh
set -euo pipefail

: "${LAZYKOINS_SITE_URL:?LAZYKOINS_SITE_URL is required}"

check() {
	local url="$1"
	for attempt in {1..10}; do
		if curl --fail --silent --show-error --max-time 10 "$url" > /dev/null; then
			echo "ok   $url"
			return 0
		fi
		echo "wait $url (attempt $attempt)"
		sleep 6
	done
	echo "::error::Smoke test failed: $url"
	return 1
}

site="${LAZYKOINS_SITE_URL%/}"
check "$site/api/health" # web → nginx → api → OK means both containers and the /api proxy work
check "$site/"
check "$site/env.js" # written by the web entrypoint at start; missing = the container did not configure itself
