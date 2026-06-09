// Concise, log-friendly rendering of errors. Logging a thrown Error object
// directly makes Bun attach a source-code preview and the full async stack,
// which buries the signal under framework frames. Formatting to a string keeps
// each failure to a line or two and surfaces the fields that matter for the
// error types we actually hit.

// Duck-typed so this stays dependency-free (no discord.js import): a
// DiscordAPIError carries an HTTP status, an API error code, and the method/url
// it failed on.
interface DiscordApiErrorShape {
  status: number;
  code: number | string;
  method: string;
  url: string;
  message: string;
}

function isDiscordApiError(e: unknown): e is DiscordApiErrorShape {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    "code" in e &&
    "url" in e &&
    "method" in e
  );
}

export function formatError(err: unknown): string {
  if (isDiscordApiError(err)) {
    const base = `Discord ${err.status}/${err.code} on ${err.method} ${err.url}: ${err.message}`;
    // 50013 = the bot's role lacks a permission in the target channel; the
    // generic "Missing Permissions" alone doesn't say which one or where.
    if (err.code === 50013) {
      return `${base}\n  -> grant the bot "View Channel" + "Send Messages" in that channel`;
    }
    return base;
  }
  if (err instanceof Error) {
    // err.stack already begins with "name: message"; returning the string (not
    // the Error object) is what avoids Bun's source-code preview noise.
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  return String(err);
}
