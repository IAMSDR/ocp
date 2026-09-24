export type LogLevel = "debug" | "info" | "warn" | "error";

export type Logger = {
  debug: (message: string, extra?: Record<string, unknown>) => void;
  info: (message: string, extra?: Record<string, unknown>) => void;
  warn: (message: string, extra?: Record<string, unknown>) => void;
  error: (message: string, extra?: Record<string, unknown>) => void;
};

const PREFIX = "[ocp]";

function consoleLogger(): Logger {
  const emit = (method: "debug" | "log" | "warn" | "error") => {
    return (message: string, extra?: Record<string, unknown>) => {
      const suffix = extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";
      console[method](`${PREFIX} ${message}${suffix}`);
    };
  };
  return {
    debug: emit("debug"),
    info: emit("log"),
    warn: emit("warn"),
    error: emit("error"),
  };
}

export const defaultLogger: Logger = consoleLogger();

/**
 * Build a logger that routes through an OpenCode structured app logger when
 * available, falling back to the console otherwise.
 */
export function createLogger(
  client?: {
    app?: {
      log?: (input: {
        body: {
          service: string;
          level: LogLevel;
          message: string;
          extra?: Record<string, unknown>;
        };
      }) => Promise<unknown>;
    };
  },
): Logger {
  const fallback = defaultLogger;
  const send =
    (level: LogLevel) =>
    (message: string, extra?: Record<string, unknown>) => {
      const log = client?.app?.log;
      if (!log) {
        fallback[level](message, extra);
        return;
      }
      void log
        .call(client!.app, {
          body: { service: "ocp", level, message, extra },
        })
        .catch(() => fallback[level](message, extra));
    };
  return {
    debug: send("debug"),
    info: send("info"),
    warn: send("warn"),
    error: send("error"),
  };
}