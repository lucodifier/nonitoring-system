import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });

/**
 * Logger controlado por LOG_LEVEL.
 * No servidor: LOG_LEVEL=error ou LOG_LEVEL=silent para não poluir stdout.
 * Níveis: silent | error | warn | info | debug (default: info; em production default: error)
 */
const LEVELS = ['silent', 'error', 'warn', 'info', 'debug'] as const;
type Level = (typeof LEVELS)[number];

const envLevel = (process.env.LOG_LEVEL || '').toLowerCase();
const isProduction = process.env.NODE_ENV === 'production';
const levelIndex = LEVELS.includes(envLevel as Level)
  ? LEVELS.indexOf(envLevel as Level)
  : isProduction
    ? LEVELS.indexOf('error')
    : LEVELS.indexOf('info');

function shouldLog(level: Level): boolean {
  const idx = LEVELS.indexOf(level);
  return idx >= 0 && idx <= levelIndex;
}

function write(level: 'error' | 'warn' | 'log', ...args: unknown[]) {
  if (level === 'error') (console as Console).error(...args);
  else if (level === 'warn') (console as Console).warn(...args);
  else (console as Console).log(...args);
}

export const log = {
  debug(...args: unknown[]) {
    if (shouldLog('debug')) write('log', ...args);
  },
  info(...args: unknown[]) {
    if (shouldLog('info')) write('log', ...args);
  },
  warn(...args: unknown[]) {
    if (shouldLog('warn')) write('warn', ...args);
  },
  error(...args: unknown[]) {
    if (shouldLog('error')) write('error', ...args);
  },
};
