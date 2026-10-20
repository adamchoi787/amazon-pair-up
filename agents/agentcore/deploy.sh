#!/usr/bin/env bash
# Deploy the AmazonPairUp Strands agent to Amazon Bedrock AgentCore Runtime:
# an ECR image (ARM64), an execution role, and the agent runtime itself.
# Re-run to ship a new image; it updates the runtime in place.
#
#   AWS_PROFILE=amazonpairup AWS_REGION=us-east-1 agents/agentcore/deploy.sh
#
# Optional: NAME (default amazonpairup_agent), MODEL (default us.amazon.nova-lite-v1:0),
# PAIRUP_MCP_URL (default the production endpoint).
# Needs Docker with buildx (ARM64 builds) and AWS CLI v2 with the bedrock-agentcore commands.
set -euo pipefail
cd "$(dirname "$0")"
export MSYS_NO_PATHCONV=1
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

PROFILE=${AWS_PROFILE:-amazonpairup}
REGION=${AWS_REGION:-us-east-1}
NAME=${NAME:-amazonpairup_agent}
MODEL=${MODEL:-us.amazon.nova-lite-v1:0}
MCP_URL=${PAIRUP_MCP_URL:-https://d3cxpkmhl89rw9.cloudfront.net/mcp}
awsx() { aws --profile "$PROFILE" --region "$REGION" "$@"; }
step() { printf '\n==> %s\n' "$*"; }

ACCOUNT=$(awsx sts get-caller-identity --query Account --output text)
REPO="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/amazonpairup-agent"
TAG=$(date -u +%Y%m%d%H%M%S)

step "Image $REPO:$TAG (linux/arm64)"
awsx ecr describe-repositories --repository-names amazonpairup-agent >/dev/null 2>&1 \
  || awsx ecr create-repository --repository-name amazonpairup-agent --image-scanning-configuration scanOnPush=true >/dev/null
awsx ecr get-login-password | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
docker buildx build --platform linux/arm64 -t "$REPO:$TAG" --push .

step "Execution role"
ROLE=amazonpairup-agentcore
TMP=$(mktemp -d)
cat > "$TMP/trust.json" <<JSON
{ "Version": "2012-10-17", "Statement": [{ "Effect": "Allow",
  "Principal": { "Service": "bedrock-agentcore.amazonaws.com" }, "Action": "sts:AssumeRole",
  "Condition": { "StringEquals": { "aws:SourceAccount": "$ACCOUNT" } } }] }
JSON
cat > "$TMP/policy.json" <<JSON
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"], "Resource": [
      "arn:aws:bedrock:*::foundation-model/amazon.nova-*",
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
      "arn:aws:bedrock:$REGION:$ACCOUNT:inference-profile/*" ] },
  { "Effect": "Allow", "Action": ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
    "Resource": "arn:aws:ecr:$REGION:$ACCOUNT:repository/amazonpairup-agent" },
  { "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
  { "Effect": "Allow", "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams", "logs:DescribeLogGroups"],
    "Resource": "arn:aws:logs:$REGION:$ACCOUNT:log-group:/aws/bedrock-agentcore/*" },
  { "Effect": "Allow", "Action": ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "cloudwatch:PutMetricData"], "Resource": "*" }
] }
JSON
if ! awsx iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  awsx iam create-role --role-name "$ROLE" --assume-role-policy-document "file://$(native "$TMP/trust.json")" >/dev/null
  sleep 10 # let the new role propagate before AgentCore assumes it
fi
awsx iam put-role-policy --role-name "$ROLE" --policy-name amazonpairup-agent --policy-document "file://$(native "$TMP/policy.json")"
ROLE_ARN=$(awsx iam get-role --role-name "$ROLE" --query Role.Arn --output text)

step "Agent runtime $NAME"
cat > "$TMP/runtime.json" <<JSON
{
  "agentRuntimeArtifact": { "containerConfiguration": { "containerUri": "$REPO:$TAG" } },
  "roleArn": "$ROLE_ARN",
  "networkConfiguration": { "networkMode": "PUBLIC" },
  "protocolConfiguration": { "serverProtocol": "HTTP" },
  "environmentVariables": { "PAIRUP_MCP_URL": "$MCP_URL", "BEDROCK_MODEL_ID": "$MODEL", "AWS_REGION": "$REGION" }
}
JSON
ID=$(awsx bedrock-agentcore-control list-agent-runtimes --query "agentRuntimes[?agentRuntimeName=='$NAME'].agentRuntimeId | [0]" --output text)
if [ "$ID" = "None" ] || [ -z "$ID" ]; then
  awsx bedrock-agentcore-control create-agent-runtime --agent-runtime-name "$NAME" --cli-input-json "file://$(native "$TMP/runtime.json")" \
    --query agentRuntimeArn --output text
else
  awsx bedrock-agentcore-control update-agent-runtime --agent-runtime-id "$ID" --cli-input-json "file://$(native "$TMP/runtime.json")" \
    --query agentRuntimeArn --output text
fi
rm -rf "$TMP"
echo "Invoke it with agents/agentcore/invoke.sh \"any news?\""
