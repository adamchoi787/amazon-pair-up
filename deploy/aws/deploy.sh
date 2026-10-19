#!/usr/bin/env bash
# Deploy VoiceMarket to AWS: CloudFormation stack (first run creates it), then
# the committed code (git HEAD) onto the instance through Systems Manager.
# Re-run any time to ship a new release; it is idempotent.
#
#   AWS_PROFILE=voicemarket AWS_REGION=us-east-1 deploy/aws/deploy.sh
#
# Optional: STACK (default voicemarket), AGENT_MODEL / INTENT_MODEL (Bedrock model or
# inference profile ids, default us.amazon.nova-lite-v1:0), INSTANCE_TYPE.
set -euo pipefail
cd "$(dirname "$0")/../.."

PROFILE=${AWS_PROFILE:-voicemarket}
REGION=${AWS_REGION:-us-east-1}
STACK=${STACK:-voicemarket}
AGENT_MODEL=${AGENT_MODEL:-us.amazon.nova-lite-v1:0}
INTENT_MODEL=${INTENT_MODEL:-$AGENT_MODEL}
INSTANCE_TYPE=${INSTANCE_TYPE:-t4g.small}
awsx() { aws --profile "$PROFILE" --region "$REGION" "$@"; }
step() { printf '\n==> %s\n' "$*"; }

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Commit your changes first: the release is built from git HEAD." >&2
  exit 1
fi

step "Account"
awsx sts get-caller-identity --query '[Account, Arn]' --output text

step "Secrets in Parameter Store (created once, reused on every deploy)"
for name in origin-secret dashboard-token; do
  if ! awsx ssm get-parameter --name "/voicemarket/$name" >/dev/null 2>&1; then
    awsx ssm put-parameter --name "/voicemarket/$name" --type SecureString --value "$(openssl rand -hex 32)" >/dev/null
    echo "created /voicemarket/$name"
  else
    echo "/voicemarket/$name exists"
  fi
done
ORIGIN_SECRET=$(awsx ssm get-parameter --name /voicemarket/origin-secret --with-decryption --query Parameter.Value --output text)

step "CloudFormation stack $STACK (the first run takes ~5 minutes for CloudFront)"
awsx cloudformation deploy \
  --stack-name "$STACK" \
  --template-file deploy/aws/voicemarket.yaml \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides "OriginSecret=$ORIGIN_SECRET" "InstanceType=$INSTANCE_TYPE"
out() { awsx cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BASE=$(out PublicBaseUrl); ORIGIN=$(out OriginHost); INSTANCE=$(out InstanceId); BUCKET=$(out ReleaseBucket); PORT=$(out AppPort)
echo "app: $BASE/app/   instance: $INSTANCE"

step "Waiting for the instance to register with Systems Manager"
for _ in $(seq 1 60); do
  status=$(awsx ssm describe-instance-information --filters "Key=InstanceIds,Values=$INSTANCE" --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)
  [ "$status" = "Online" ] && break
  sleep 5
done
[ "$status" = "Online" ] || { echo "instance $INSTANCE is not reachable through SSM" >&2; exit 1; }

step "Release"
RELEASE="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"
KEY="releases/$RELEASE.tgz"
TMP=$(mktemp -d)
git archive --format=tar.gz -o "$TMP/release.tgz" HEAD
awsx s3 cp --only-show-errors "$TMP/release.tgz" "s3://$BUCKET/$KEY"
echo "uploaded $KEY"

ENV_FILE=$(cat <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=$PORT
PGLITE_DIR=/var/lib/voicemarket/pglite
SEED_ON_START=true
AUTH_MODE=oauth
PUBLIC_BASE_URL=$BASE
ALLOWED_HOSTS=$ORIGIN,127.0.0.1,localhost
ALLOWED_ORIGINS=$BASE
AI_MODE=bedrock
AWS_REGION=$REGION
BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v2:0
BEDROCK_INTENT_MODEL_ID=$INTENT_MODEL
BEDROCK_AGENT_MODEL_ID=$AGENT_MODEL
EMBEDDING_DIM=1024
EOF
)
node -e '
  const [script, bucket, key, release, env, out] = process.argv.slice(1);
  const b64 = (s) => Buffer.from(s).toString("base64");
  const commands = [
    `echo ${b64(require("fs").readFileSync(script, "utf8"))} | base64 -d > /tmp/voicemarket-install.sh`,
    `bash /tmp/voicemarket-install.sh ${bucket} ${key} ${release} ${b64(env + "\n")}`,
  ];
  require("fs").writeFileSync(out, JSON.stringify({ commands, executionTimeout: ["1200"] }));
' deploy/aws/remote-install.sh "$BUCKET" "$KEY" "$RELEASE" "$ENV_FILE" "$TMP/params.json"

step "Installing on $INSTANCE"
COMMAND=$(awsx ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --comment "voicemarket $RELEASE" --parameters "file://$TMP/params.json" --query Command.CommandId --output text)
rm -rf "$TMP"
for _ in $(seq 1 240); do
  state=$(awsx ssm get-command-invocation --command-id "$COMMAND" --instance-id "$INSTANCE" --query Status --output text 2>/dev/null || echo Pending)
  case "$state" in Success|Failed|Cancelled|TimedOut) break ;; esac
  sleep 5
done
awsx ssm get-command-invocation --command-id "$COMMAND" --instance-id "$INSTANCE" --query StandardOutputContent --output text | tail -n 5
if [ "$state" != "Success" ]; then
  awsx ssm get-command-invocation --command-id "$COMMAND" --instance-id "$INSTANCE" --query StandardErrorContent --output text | tail -n 40 >&2
  echo "install $state" >&2
  exit 1
fi

step "Checking $BASE"
for _ in $(seq 1 30); do
  curl -fsS "$BASE/health" && echo && break
  sleep 10
done
curl -fsS -o /dev/null -w "web app: HTTP %{http_code}\n" "$BASE/app/"
echo
echo "VoiceMarket is live: $BASE/app/"
echo "Dashboard: $BASE/dashboard/#token=<value of /voicemarket/dashboard-token>"
