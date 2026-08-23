import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  buildAdkChatArgs,
  runConversationSuite,
  type AgentChatResult,
  type ConversationSuite,
} from './lib/agent-a-conversation-runner';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const botpressDir = path.join(projectRoot, 'botpress-agent');
const defaultSuitePath = path.join(
  botpressDir,
  'evals/personas/studyx-happy-path-cases-v6.json',
);

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function makeRunId(): string {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14);
}

async function sendTurn(
  message: string,
  conversationId: string | null,
): Promise<AgentChatResult> {
  const { stdout } = await execFileAsync(
    'adk',
    buildAdkChatArgs(message, conversationId, argument('--timeout') ?? '1m'),
    { cwd: botpressDir, timeout: 75_000, maxBuffer: 2 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as AgentChatResult & { error?: string };
  if (parsed.error) throw new Error(parsed.error);
  if (!parsed.conversationId || !Array.isArray(parsed.responses)) {
    throw new Error('INVALID_ADK_CHAT_RESPONSE');
  }
  return parsed;
}

async function main() {
  const suitePath = path.resolve(argument('--file') ?? defaultSuitePath);
  const suite = JSON.parse(await readFile(suitePath, 'utf8')) as ConversationSuite;
  const requestedCase = argument('--case');
  const selectedSuite: ConversationSuite = {
    ...suite,
    cases: requestedCase ? suite.cases.filter((item) => item.id === requestedCase) : suite.cases,
  };
  if (selectedSuite.cases.length === 0) throw new Error('NO_MATCHING_CASES');

  const runId = argument('--run-id') ?? makeRunId();
  const report = await runConversationSuite(selectedSuite, {
    runId,
    sendTurn,
    onCase: (current, total, id) => console.error(`[${current}/${total}] ${id}`),
    onTurn: (current, total) => console.error(`  turno ${current}/${total}`),
  });

  const outputDir = path.join(botpressDir, 'evals/results');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `happy-path-${runId}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({ ...report.summary, output: outputPath }, null, 2));
  if (report.summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

