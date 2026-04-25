export class VeloError extends Error {
  constructor(public message: string, public status: number, public code?: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends VeloError {
  constructor(message = "Bad Request") {
    super(message, 400, "BAD_REQUEST");
  }
}

export class UnauthorizedError extends VeloError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends VeloError {
  constructor(message = "Forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends VeloError {
  constructor(message = "Not Found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class MethodNotAllowedError extends VeloError {
  constructor(message = "Method Not Allowed") {
    super(message, 405, "METHOD_NOT_ALLOWED");
  }
}

export class PayloadTooLargeError extends VeloError {
  constructor(message = "Payload Too Large") {
    super(message, 413, "PAYLOAD_TOO_LARGE");
  }
}

export class UnprocessableEntityError extends VeloError {
  constructor(message = "Unprocessable Entity", public fields?: Record<string, unknown>[]) {
    super(message, 422, "UNPROCESSABLE_ENTITY");
  }
}

export class TooManyRequestsError extends VeloError {
  constructor(message = "Too Many Requests") {
    super(message, 429, "TOO_MANY_REQUESTS");
  }
}

export class InternalServerError extends VeloError {
  constructor(message = "Internal Server Error") {
    super(message, 500, "INTERNAL_SERVER_ERROR");
  }
}

export class BodyAlreadyConsumedError extends VeloError {
  constructor(message = "Body already consumed") {
    super(message, 500, "BODY_ALREADY_CONSUMED");
  }
}

export class ResponseAlreadySentError extends VeloError {
  constructor(message = "Response already sent") {
    super(message, 500, "RESPONSE_ALREADY_SENT");
  }
}
