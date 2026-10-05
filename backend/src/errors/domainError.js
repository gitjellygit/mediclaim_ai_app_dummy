export class DomainError extends Error {
  constructor(message, { status = 400, code = "DOMAIN_ERROR", details = undefined } = {}) {
    super(message);
    this.name = "DomainError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function conflict(message, code = "CONFLICT") {
  return new DomainError(message, { status: 409, code });
}
