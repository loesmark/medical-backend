/**
 * Lightweight console logger with level filtering & ISO timestamps.
 * Swap for pino/winston later without touching call sites — keep the same method names.
 */

const config = require('../config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[config.log.level] ?? LEVELS.info;

function stamp() {
  return new Date().toISOString();
}

function fmt(level, scope, message, meta) {
  const base = `[${stamp()}] ${level.toUpperCase()}${scope ? ` (${scope})` : ''}: ${message}`;
  if (meta !== undefined) return `${base} ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`;
  return base;
}

const logger = {
  error: (scope, message, meta) => currentLevel >= LEVELS.error && console.error(fmt('error', scope, message, meta)),
  warn: (scope, message, meta) => currentLevel >= LEVELS.warn && console.warn(fmt('warn', scope, message, meta)),
  info: (scope, message, meta) => currentLevel >= LEVELS.info && console.log(fmt('info', scope, message, meta)),
  debug: (scope, message, meta) => currentLevel >= LEVELS.debug && console.debug(fmt('debug', scope, message, meta)),
};

module.exports = logger;
