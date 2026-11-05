export class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
export const notFound = (what: string) => new ServiceError(404, "not_found", `${what} not found.`);
export const forbidden = (msg: string) => new ServiceError(403, "forbidden", msg);
export const conflict = (code: string, msg: string) => new ServiceError(409, code, msg);
export const invalid = (msg: string) => new ServiceError(422, "invalid", msg);
