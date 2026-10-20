# Runtime evidence pending deployment

The collector is implemented and tested locally. No live AWS call was made in this preparation session. Tony runs it after deploying the submitted commit:

```bash
# PAIRUP_TOKEN is the signed-in test user's access token, supplied through env.
npm run evidence -- --url https://your-public-origin
# Optional: invoke the actual hosted AgentCore runtime using Tony's AWS CLI credentials.
npm run evidence -- --url https://your-public-origin --agentcore-arn <runtime-arn>
```

The command replaces this file with dated actual health/build/model responses and, when requested, the AgentCore stream. It checks deployed revision and UI fingerprint. An offline fallback records an incomplete result, even if the configured mode says Bedrock. Review the generated report before committing; access tokens are redacted and never printed by the collector.

Local negative check on October 20, 2026: a mock server returned `inference: offline`; the collector wrote `.data/EVIDENCE-local.md`, marked it **incomplete**, and exited with code 1. That verifies the collection guard, rather than supplying live AWS evidence.
