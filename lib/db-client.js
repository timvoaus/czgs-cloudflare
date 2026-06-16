/**
 * Cloudflare D1 wrapper to emulate node:sqlite DatabaseSync API.
 * Maps synchronous SQLite methods to asynchronous D1 methods.
 */
export class D1DatabaseWrapper {
  constructor(d1Binding) {
    this.d1 = d1Binding;
  }

  async exec(sql) {
    return await this.d1.exec(sql);
  }

  prepare(sql) {
    const d1Stmt = this.d1.prepare(sql);
    return new D1PreparedStatementWrapper(d1Stmt);
  }

  async batch(statements) {
    const rawStatements = statements.map(s => s.d1Stmt || s);
    return await this.d1.batch(rawStatements);
  }
}

class D1PreparedStatementWrapper {
  constructor(d1Stmt) {
    this.d1Stmt = d1Stmt;
  }

  bind(...params) {
    return new D1PreparedStatementWrapper(this.d1Stmt.bind(...params));
  }

  async all(...params) {
    // If no params, bind is not strictly required but safe
    const bound = params.length > 0 ? this.d1Stmt.bind(...params) : this.d1Stmt;
    const res = await bound.all();
    return res.results || [];
  }

  async get(...params) {
    const bound = params.length > 0 ? this.d1Stmt.bind(...params) : this.d1Stmt;
    const res = await bound.first();
    return res === null ? undefined : res;
  }

  async run(...params) {
    const bound = params.length > 0 ? this.d1Stmt.bind(...params) : this.d1Stmt;
    return await bound.run();
  }
}
