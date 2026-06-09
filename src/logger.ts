// Unified logging behind console.*. Each module makes its own named logger via
// makeLogger("name"); every line is prefixed with an ISO timestamp and the
// logger name, e.g. `2026-06-09T12:00:00.000Z [bot] message`. Methods map
// straight to the matching console method so output streams (stdout/stderr) and
// formatting (%s, object inspection, error stacks) stay identical.

type LogMethod = (...args: unknown[]) => void;

export type Logger = {
  log: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  debug: LogMethod;
};

function prefix(name: string): string {
  return `${new Date().toISOString()} [${name}]`;
}

export function makeLogger(name: string): Logger {
  return {
    log: (...args) => console.log(prefix(name), ...args),
    info: (...args) => console.info(prefix(name), ...args),
    warn: (...args) => console.warn(prefix(name), ...args),
    error: (...args) => console.error(prefix(name), ...args),
    debug: (...args) => console.debug(prefix(name), ...args),
  };
}
