import { z } from "zod";

// Single source for runtime env: validation, coercion, and defaults. Parsed once
// at process start; callers receive a typed, validated object instead of poking
// process.env.

// Backend selection only. Split out so migrate.ts / db code can validate without
// requiring the auth creds they don't use. DATABASE_URL absent => sqlite backend.
const DbEnvSchema = z.object({
  DATABASE_URL: z.url().optional(),
  SQLITE_PATH: z.string().default("./data/dev.sqlite"),
});

const EnvSchema = DbEnvSchema.extend({
  RSF_USER: z.string().min(1),
  RSF_PASS: z.string().min(1),
  RSF_USER_ID: z.coerce.number().int().positive(),
  RSF_AUTH_PATH: z.string().default(".auth.json"),
});

export type DbEnv = z.infer<typeof DbEnvSchema>;
export type Env = z.infer<typeof EnvSchema>;

function parseOrThrow<T>(schema: z.ZodType<T>): T {
  const r = schema.safeParse(process.env);
  if (!r.success) {
    throw new Error(`invalid environment:\n${z.prettifyError(r.error)}`);
  }
  return r.data;
}

export const loadEnv = (): Env => parseOrThrow(EnvSchema);
export const loadDbEnv = (): DbEnv => parseOrThrow(DbEnvSchema);
