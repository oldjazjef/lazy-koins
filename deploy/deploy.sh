#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Deploys one environment on Coolify (called by .github/workflows/_deploy.yml).
#
# By now the images are tagged ":$DEPLOY_ENV" (test | production). The Coolify resource of that
# environment uses those tags (IMAGE_TAG) with pull_policy: always, so a redeploy is enough:
# this script asks Coolify to redeploy and waits for the result.
#
# Variables (GitHub → Settings → Environments → <env>):
#   COOLIFY_URL            vars     https://coolify.example.com (the Coolify dashboard)
#   COOLIFY_RESOURCE_UUIDS vars     UUID(s) of the resource(s) to redeploy, comma-separated
#   COOLIFY_TOKEN          secrets  Coolify API token (Keys & Tokens → API tokens, "deploy" permission)
# Without COOLIFY_TOKEN the script only reports the built images and exits 0.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${DEPLOY_ENV:?DEPLOY_ENV is required}"
: "${REGISTRY:?REGISTRY is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"

if [[ -z "${COOLIFY_TOKEN:-}" ]]; then
	echo "::notice title=Deploy skipped::No Coolify token for '$DEPLOY_ENV' (secret COOLIFY_TOKEN). Images are built and tagged ${REGISTRY,,}/lazykoins-<api|web>:$IMAGE_TAG (also :$DEPLOY_ENV)."
	exit 0
fi
: "${COOLIFY_URL:?COOLIFY_URL is required (environment variable in GitHub)}"
: "${COOLIFY_RESOURCE_UUIDS:?COOLIFY_RESOURCE_UUIDS is required (environment variable in GitHub)}"

api="${COOLIFY_URL%/}/api/v1"
auth=(--header "Authorization: Bearer $COOLIFY_TOKEN" --header "Accept: application/json")

echo "Redeploying $DEPLOY_ENV ($IMAGE_TAG) on Coolify…"
if ! response="$(curl --fail-with-body --silent --show-error "${auth[@]}" \
	--request POST --get --data-urlencode "uuid=$COOLIFY_RESOURCE_UUIDS" --data "force=false" \
	"$api/deploy")"; then
	echo "$response"
	echo "::error title=Deploy failed::Coolify rejected the deploy request. A 404 means no resource with UUID '$COOLIFY_RESOURCE_UUIDS' is visible to this token: set COOLIFY_RESOURCE_UUIDS in the GitHub environment '$DEPLOY_ENV' to the resource's UUID (Coolify URL …/service/<UUID>, not the project or environment UUID), and make sure COOLIFY_TOKEN belongs to the same Coolify team."
	exit 1
fi
echo "$response"

# Wait for every deployment Coolify reports (services may not report one; the smoke test covers those).
mapfile -t deployments < <(jq -r '.deployments[]?.deployment_uuid // empty' <<<"$response")
for deployment in "${deployments[@]}"; do
	for _ in {1..60}; do
		status="$(curl --fail --silent --show-error "${auth[@]}" "$api/deployments/$deployment" | jq -r '.status')"
		case "$status" in
			finished)
				echo "Deployment $deployment finished."
				continue 2
				;;
			failed | cancelled*)
				echo "::error title=Deploy failed::Coolify deployment $deployment ended with status '$status'. See the logs in Coolify."
				exit 1
				;;
		esac
		echo "Deployment $deployment: $status"
		sleep 10
	done
	echo "::error title=Deploy timed out::Coolify deployment $deployment did not finish within 10 minutes."
	exit 1
done
