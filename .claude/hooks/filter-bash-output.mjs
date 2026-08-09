#!/usr/bin/env node
/**
 * PostToolUse(Bash): recorta salidas enormes antes de que lleguen al contexto.
 *
 * DISEÑO FAIL-SAFE: ante CUALQUIER duda (JSON inesperado, campo ausente,
 * error propio) sale con código 0 y sin stdout => passthrough, la salida
 * original llega intacta. Este hook nunca puede romper el tool Bash.
 *
 * Para desactivarlo: borrar el bloque "hooks" de .claude/settings.json
 */
const MAX_CHARS = 12000;   // ~3k tokens
const HEAD_LINES = 40;
const TAIL_LINES = 60;
const SIGNAL = /\b(error|failed|failing|fail:|exception|✕|✗|FAIL|assert|expected|received|ERR_|Cannot find|Type error|TS\d{4})\b/i;

function passthrough() { process.exit(0); }

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  try {
    if (!raw.trim()) return passthrough();
    const input = JSON.parse(raw);

    const response = input?.tool_response;
    if (typeof response !== 'string' && typeof response?.stdout !== 'string') return passthrough();

    const isPlainString = typeof response === 'string';
    const text = isPlainString ? response : response.stdout;
    if (typeof text !== 'string' || text.length <= MAX_CHARS) return passthrough();

    const lines = text.split('\n');
    const head = lines.slice(0, HEAD_LINES);
    const tail = lines.slice(-TAIL_LINES);
    const middle = lines.slice(HEAD_LINES, -TAIL_LINES);
    const signals = middle.filter((l) => SIGNAL.test(l)).slice(0, 80);

    const parts = [
      head.join('\n'),
      `\n… [${middle.length} líneas omitidas por el filtro de contexto]`,
    ];
    if (signals.length) {
      parts.push(`\n── líneas con señal de error (${signals.length}) ──\n${signals.join('\n')}`);
    }
    parts.push(`\n── final ──\n${tail.join('\n')}`);
    parts.push(
      `\n[filter-bash-output: ${text.length} chars recortados. ` +
      `Si necesitás el detalle completo, volvé a correr el comando con un grep/filtro más angosto ` +
      `o delegá la inspección al subagente studyx-scout.]`
    );

    const updated = parts.join('\n');
    const payload = {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        updatedToolOutput: isPlainString ? updated : { ...response, stdout: updated },
      },
    };
    process.stdout.write(JSON.stringify(payload));
    process.exit(0);
  } catch {
    passthrough();
  }
});
process.stdin.on('error', passthrough);
