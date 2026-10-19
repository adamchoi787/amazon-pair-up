#!/bin/bash
# Runs on the instance through SSM (see deploy.sh). Installs one release and
# restarts the service, keeping the previous releases for a quick rollback.
#   remote-install.sh <bucket> <s3-key> <release-id> <env-file-base64>
set -euo pipefail
BUCKET=$1 KEY=$2 RELEASE=$3 ENV_B64=$4

# On a brand-new instance, wait for first-boot setup (Node.js, service unit) to finish.
cloud-init status --wait >/dev/null || true
REGION=$(TOKEN=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60") \
  && curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)

secret() { aws ssm get-parameter --region "$REGION" --name "$1" --with-decryption --query Parameter.Value --output text; }

# Environment: public settings from the deploy script, secrets from Parameter Store.
umask 027
{
  echo "$ENV_B64" | base64 -d
  echo "ORIGIN_SECRET=$(secret /voicemarket/origin-secret)"
  echo "DASHBOARD_TOKEN=$(secret /voicemarket/dashboard-token)"
} > /etc/voicemarket.env.new
chown root:voicemarket /etc/voicemarket.env.new
mv -f /etc/voicemarket.env.new /etc/voicemarket.env

# Release
DIR=/opt/voicemarket/releases/$RELEASE
rm -rf "$DIR" && mkdir -p "$DIR"
aws s3 cp --region "$REGION" --only-show-errors "s3://$BUCKET/$KEY" /tmp/release.tgz
tar -xzf /tmp/release.tgz -C "$DIR" && rm -f /tmp/release.tgz
cd "$DIR"
HOME=/root PATH=/usr/local/bin:$PATH npm ci --omit=dev --no-audit --no-fund --loglevel=error
chmod -R a+rX "$DIR"

# Switch atomically and restart
ln -sfn "$DIR" /opt/voicemarket/current.next
mv -Tf /opt/voicemarket/current.next /opt/voicemarket/current
systemctl enable voicemarket >/dev/null 2>&1
systemctl restart voicemarket

PORT=$(grep -E '^PORT=' /etc/voicemarket.env | cut -d= -f2)
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${PORT:-8080}/health"; then
    echo
    echo "release $RELEASE is live"
    ls -1dt /opt/voicemarket/releases/* | tail -n +4 | xargs -r rm -rf
    exit 0
  fi
  sleep 2
done
echo "release $RELEASE did not become healthy; recent logs:" >&2
journalctl -u voicemarket -n 80 --no-pager >&2
exit 1
