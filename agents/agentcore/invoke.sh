#!/usr/bin/env bash
# Talk to the deployed agent: agents/agentcore/invoke.sh "I need a graphing calculator, max 18 dollars"
# PAIRUP_TOKEN is the user's AmazonPairUp access token (from signing in to the web app).
# SESSION keeps a conversation going across calls (33+ characters).
set -euo pipefail
export MSYS_NO_PATHCONV=1
PROFILE=${AWS_PROFILE:-amazonpairup}
REGION=${AWS_REGION:-us-east-1}
NAME=${NAME:-amazonpairup_agent}
SESSION=${SESSION:-amazonpairup-session-$(date -u +%Y%m%d)-000000000000}
awsx() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

ARN=$(awsx bedrock-agentcore-control list-agent-runtimes --query "agentRuntimes[?agentRuntimeName=='$NAME'].agentRuntimeArn | [0]" --output text)
PAYLOAD=$(node -e 'console.log(JSON.stringify({ prompt: process.argv[1], pairup_token: process.env.PAIRUP_TOKEN || undefined }))' "$1")
OUT=$(mktemp)
awsx bedrock-agentcore invoke-agent-runtime --agent-runtime-arn "$ARN" --runtime-session-id "$SESSION" \
  --content-type application/json --accept text/event-stream --payload "$PAYLOAD" --cli-binary-format raw-in-base64-out \
  "$OUT" >/dev/null
# Join the streamed text deltas into the spoken reply.
node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");console.log(t.split("\n").filter(l=>l.startsWith("data: ")).map(l=>{try{return JSON.parse(l.slice(6)).text??""}catch{return ""}}).join(""))' "$OUT"
rm -f "$OUT"
