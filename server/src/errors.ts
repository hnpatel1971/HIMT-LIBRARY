export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Set when a librarian may repeat the request with `override: true`. */
    public overridable = false,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, `${what} not found`);
export const badRequest = (msg: string) => new AppError(400, msg);
