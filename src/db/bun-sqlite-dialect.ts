import type { Database, SQLQueryBindings, Statement } from "bun:sqlite";
import {
  CompiledQuery,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type Driver,
  type Kysely,
  type QueryCompiler,
  type QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";

// Minimal Kysely dialect over bun:sqlite. Replaces the kysely-bun-sqlite package,
// which ships a CJS entry that `require("kysely")` — broken under Bun because
// kysely is async ESM. Mirrors Kysely's own SqliteDialect, adapted to bun:sqlite's
// Statement API (variadic params, `columnNames` instead of `reader`).
//
// Single shared connection, no mutex — same as Kysely's better-sqlite3 dialect.
// Safe here because queries are issued sequentially (one awaited stage at a time).
export class BunSqliteDialect implements Dialect {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  createDriver(): Driver {
    return new BunSqliteDriver(this.#db);
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }

  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
}

class BunSqliteDriver implements Driver {
  readonly #connection: BunSqliteConnection;

  constructor(db: Database) {
    this.#connection = new BunSqliteConnection(db);
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return this.#connection;
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("begin"));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("commit"));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("rollback"));
  }

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {
    this.#connection.close();
  }
}

class BunSqliteConnection implements DatabaseConnection {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const { sql, parameters } = compiledQuery;
    const params = parameters as SQLQueryBindings[];
    const stmt = this.#db.prepare(sql);
    // Non-empty columnNames => statement returns rows (SELECT or ... RETURNING).
    if (stmt.columnNames.length > 0) {
      return { rows: stmt.all(...params) as R[] };
    }
    const { changes, lastInsertRowid } = stmt.run(...params);
    return {
      insertId: lastInsertRowid != null ? BigInt(lastInsertRowid) : undefined,
      numAffectedRows: changes != null ? BigInt(changes) : undefined,
      rows: [],
    };
  }

  async *streamQuery<R>(compiledQuery: CompiledQuery): AsyncIterableIterator<QueryResult<R>> {
    const { sql, parameters } = compiledQuery;
    const stmt: Statement = this.#db.prepare(sql);
    for (const row of stmt.iterate(...(parameters as SQLQueryBindings[]))) {
      yield { rows: [row as R] };
    }
  }

  close(): void {
    this.#db.close();
  }
}
