/** Shared domain error; pure planning/import tools must not initialize a database. */
export class EscalaError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "EscalaError";
  }
}
