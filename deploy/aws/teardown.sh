#!/usr/bin/env bash
# Remove the AmazonPairUp stack and everything it created. Keeps the secrets in
# Parameter Store (free) unless PURGE_SECRETS=1, and lists any EBS snapshots
# left behind (DLM snapshots outlive the stack and are billed until deleted).
#
#   AWS_PROFILE=amazonpairup AWS_REGION=us-east-1 deploy/aws/teardown.sh
set -euo pipefail
PROFILE=${AWS_PROFILE:-amazonpairup}
REGION=${AWS_REGION:-us-east-1}
STACK=${STACK:-amazonpairup}
awsx() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

BUCKET=$(awsx cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='ReleaseBucket'].OutputValue" --output text)
read -r -p "Delete stack $STACK and all its data in $REGION? Type the stack name to confirm: " answer
[ "$answer" = "$STACK" ] || { echo "Cancelled."; exit 1; }

[ -n "$BUCKET" ] && [ "$BUCKET" != "None" ] && awsx s3 rm "s3://$BUCKET" --recursive --only-show-errors
awsx cloudformation delete-stack --stack-name "$STACK"
echo "Waiting for the stack to be deleted (CloudFront takes a few minutes)…"
awsx cloudformation wait stack-delete-complete --stack-name "$STACK"

if [ "${PURGE_SECRETS:-0}" = "1" ]; then
  awsx ssm delete-parameters --names /amazonpairup/origin-secret /amazonpairup/dashboard-token >/dev/null
fi
echo "Snapshots still in the account (delete them in the EC2 console if you don't need them):"
awsx ec2 describe-snapshots --owner-ids self --filters Name=tag:amazonpairup-backup,Values=daily \
  --query 'Snapshots[].[SnapshotId,StartTime,VolumeSize]' --output table
