#!/usr/bin/env bash
set -euo pipefail
# Disposable local lab only. No ambient provider credentials, no external TCP.
exec env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
  NODE_OPTIONS='--require ./tests/helpers/local-only-network.cjs' \
  GOOGLE_APPLICATION_CREDENTIALS=/dev/null NEXT_TELEMETRY_DISABLED=1 \
  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  BUSINESS_WORKSPACE_SLUG=studyx STUDYX_EVAL_API_BASE_URL=http://127.0.0.1:3217 \
  ORCHESTRATOR_API_KEY=eval-orchestrator-key ORCHESTRATOR_KEY_ID=botpress-eval \
  STUDYX_SIGNING_SECRET=eval-signing-secret CRON_SECRET=local-eval-cron \
  PAYMENT_PROVIDER=fake PAYMENT_LINK_ENVIRONMENT=test \
  PAYMENT_LINK_12M=https://buy.stripe.com/test_local-eval-12m \
  PAYMENT_LINK_6M=https://buy.stripe.com/test_local-eval-6m \
  PAYMENT_LINK_CONTADO=https://buy.stripe.com/test_local-eval-contado \
  PAYMENT_LINK_SANDBOX_12M=https://buy.stripe.com/test_local-eval-12m \
  PAYMENT_LINK_SANDBOX_6M=https://buy.stripe.com/test_local-eval-6m \
  PAYMENT_LINK_SANDBOX_CONTADO=https://buy.stripe.com/test_local-eval-contado \
  AGENT_A_BRAIN_V1_ENABLED=true AGENT_A_BRAIN_V1_SHADOW=false AGENT_A_REPAIR_ENABLED=true \
  AGENT_A_CONTEXT_SCOPING=false AGENT_A_STATE_ASSERTIONS=true AGENT_A_SINGLE_ROUTE=true \
  CONVERSATION_PIPELINE_V1_ENABLED=false COURSE_BONUS_FLOW_MODE=direct \
  COURSE_BONUS_MAX_COURSES=3 CENTRAL_CARGA_BONUS_ENABLED=true "$@"
