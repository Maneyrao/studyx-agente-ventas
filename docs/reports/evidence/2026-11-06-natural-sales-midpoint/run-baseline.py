import os, subprocess, json, time
from pathlib import Path
root=Path.cwd()
evidence=root/'docs/reports/evidence/2026-11-06-natural-sales-midpoint'
env={k:os.environ[k] for k in ['PATH','HOME','TMPDIR'] if k in os.environ}
env.update(LC_ALL='C',DATABASE_URL='postgresql://postgres@127.0.0.1:55435/studyx_test',TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55435/studyx_test',BUSINESS_WORKSPACE_SLUG='studyx',NEXT_TELEMETRY_DISABLED='1')
integration=['contact-profile-phone-confirmation','agent-a-call-handoff','post-call-followup','course-program-delivery','direct-course-bonus-checkout','direct-course-bonus-persistence','payments-canonical','stripe-webhook','central-carga-enrollment-worker','lead-course-interests','agent-a-memory-projection','inbound-receipts','zero-silence','post-sale']
unit=['heuristics/opt-out','botpress/botpress-media-downloader','botpress/gemini-transcription','botpress/groq-transcription','botpress/commercial-followup-trigger','promotions/commercial-followup-service']
commands=[('root-typecheck',['npm','run','typecheck']),('bot-typecheck',['npm','--prefix','botpress-agent','run','typecheck']),('manifest',['npx','--no-install','vitest','run','--config','vitest.config.mts','tests/unit/scripts/release-manifest-agent-loop.test.ts']),('integration',['npx','--no-install','vitest','run','--config','vitest.integration.config.mts']+[f'tests/integration/{name}.test.ts' for name in integration]),('unit',['npx','--no-install','vitest','run','--config','vitest.config.mts']+[f'tests/unit/{name}.test.ts' for name in unit]),('offline-replay',['npx','--no-install','vitest','run','--config','evals/golden/offline-replay.config.mts']),('baseline-v8-replay',['npx','--no-install','vitest','run','--config','evals/golden/vitest.config.mts','evals/golden/replay-baseline-v8.test.ts'])]
results=[]
for name,command in commands:
    started=time.time()
    with (evidence/f'baseline-{name}.log').open('w') as log:
        result=subprocess.run(command,env=env,stdout=log,stderr=subprocess.STDOUT)
    results.append(dict(name=name,command=command,exit_code=result.returncode,elapsed_seconds=round(time.time()-started,2)))
    (evidence/'baseline-results.json').write_text(json.dumps(results,indent=2)+'\n')
    print(name,result.returncode,flush=True)
