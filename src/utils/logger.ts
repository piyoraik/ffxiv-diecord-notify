const LEVEL_ORDER: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

type LogLevel = keyof typeof LEVEL_ORDER;
type LogMeta = Record<string, unknown> | undefined;

const currentLevel = (() => {
  const level = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return LEVEL_ORDER[level] ?? LEVEL_ORDER.info;
})();

const shouldLog = (level: LogLevel): boolean => LEVEL_ORDER[level] >= currentLevel;

const formatPayload = (level: LogLevel, message: string, meta?: LogMeta, error?: unknown): string => {
  const payload: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    message
  };
  if (meta && Object.keys(meta).length > 0) {
    payload.meta = meta;
  }
  if (error instanceof Error) {
    payload.error = {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  } else if (typeof error !== 'undefined') {
    payload.error = error;
  }
  return JSON.stringify(payload);
};

export const logDebug = (message: string, meta?: LogMeta): void => {
  if (!shouldLog('debug')) return;
  console.log(formatPayload('debug', message, meta));
};

export const logInfo = (message: string, meta?: LogMeta): void => {
  if (!shouldLog('info')) return;
  console.log(formatPayload('info', message, meta));
};

export const logWarn = (message: string, meta?: LogMeta, error?: unknown): void => {
  if (!shouldLog('warn')) return;
  console.warn(formatPayload('warn', message, meta, error));
};

export const logError = (message: string, meta?: LogMeta, error?: unknown): void => {
  if (!shouldLog('error')) return;
  console.error(formatPayload('error', message, meta, error));
};
