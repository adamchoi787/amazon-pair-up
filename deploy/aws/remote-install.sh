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
  echo "ORIGIN_SECRET=$(secret /amazonpairup/origin-secret)"
  echo "DASHBOARD_TOKEN=$(secret /amazonpairup/dashboard-token)"
} > /etc/amazonpairup.env.new
chown root:amazonpairup /etc/amazonpairup.env.new
mv -f /etc/amazonpairup.env.new /etc/amazonpairup.env

# Release
DIR=/opt/amazonpairup/releases/$RELEASE
rm -rf "$DIR" && mkdir -p "$DIR"
aws s3 cp --region "$REGION" --only-show-errors "s3://$BUCKET/$KEY" /tmp/release.tgz
tar -xzf /tmp/release.tgz -C "$DIR" && rm -f /tmp/release.tgz
cd "$DIR"
HOME=/root PATH=/usr/local/bin:$PATH npm ci --omit=dev --no-audit --no-fund --loglevel=error
chmod -R a+rX "$DIR"

# Logs to CloudWatch (best effort: without the agent, logs stay in journald).
# The service appends its JSON lines to a file the agent ships to /amazonpairup/app.
setup_cloudwatch() {
  rpm -q amazon-cloudwatch-agent >/dev/null 2>&1 || dnf -y -q install amazon-cloudwatch-agent >/dev/null
  install -d -o amazonpairup -g amazonpairup -m 755 /var/log/amazonpairup
  mkdir -p /etc/systemd/system/amazonpairup.service.d
  cat > /etc/systemd/system/amazonpairup.service.d/logs.conf <<'CONF'
[Service]
StandardOutput=append:/var/log/amazonpairup/app.log
StandardError=append:/var/log/amazonpairup/app.log
CONF
  cat > /etc/logrotate.d/amazonpairup <<'CONF'
/var/log/amazonpairup/app.log {
  daily
  rotate 3
  compress
  missingok
  notifempty
  copytruncate
}
CONF
  cat > /opt/aws/amazon-cloudwatch-agent/etc/amazonpairup.json <<'CONF'
{ "logs": { "logs_collected": { "files": { "collect_list": [
  { "file_path": "/var/log/amazonpairup/app.log", "log_group_name": "/amazonpairup/app", "log_stream_name": "{instance_id}" }
] } } } }
CONF
  /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s     -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazonpairup.json >/dev/null
  systemctl daemon-reload
}
setup_cloudwatch || echo "warning: CloudWatch log shipping is not set up; logs stay in journald" >&2

# Switch atomically and restart
ln -sfn "$DIR" /opt/amazonpairup/current.next
mv -Tf /opt/amazonpairup/current.next /opt/amazonpairup/current
systemctl enable amazonpairup >/dev/null 2>&1
systemctl restart amazonpairup

PORT=$(grep -E '^PORT=' /etc/amazonpairup.env | cut -d= -f2)
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${PORT:-8080}/ready"; then
    echo
    echo "release $RELEASE is live"
    ls -1dt /opt/amazonpairup/releases/* | tail -n +4 | xargs -r rm -rf
    exit 0
  fi
  sleep 2
done
echo "release $RELEASE did not become healthy; recent logs:" >&2
tail -n 80 /var/log/amazonpairup/app.log 2>/dev/null >&2 || journalctl -u amazonpairup -n 80 --no-pager >&2
exit 1
