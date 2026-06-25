type LogLevel = 'info' | 'warn' | 'error';

interface LogFields {
  event: string;
  [key: string]: unknown;
}

function log(level: LogLevel, fields: LogFields): void {
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    ...fields,
  };
  // JSON lines to stdout — collected by Vercel log drains
  console.log(JSON.stringify(entry));
}

export const logger = {
  info: (fields: LogFields) => log('info', fields),
  warn: (fields: LogFields) => log('warn', fields),
  error: (fields: LogFields) => log('error', fields),
};
