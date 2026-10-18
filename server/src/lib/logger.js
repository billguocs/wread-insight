/** 结构化 JSON 日志，携带 requestId，绝不记录密钥/令牌 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function emit(level, msg, fields = {}) {
  if (LEVELS[level] < threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  const out = JSON.stringify(line);
  if (level === 'error') process.stderr.write(out + '\n');
  else process.stdout.write(out + '\n');
}

const REDACT = /(api[_-]?key|authorization|token|password|secret)/i;

function scrub(fields) {
  const clean = {};
  for (const [k, v] of Object.entries(fields || {})) {
    clean[k] = REDACT.test(k) ? '[redacted]' : v;
  }
  return clean;
}

export const logger = {
  debug: (m, f) => emit('debug', m, scrub(f)),
  info: (m, f) => emit('info', m, scrub(f)),
  warn: (m, f) => emit('warn', m, scrub(f)),
  error: (m, f) => emit('error', m, scrub(f)),
};