/** 类型化错误体系：客户端只看到规范化结构，绝不泄露堆栈与内部细节 */
export class AppError extends Error {
  constructor(message, { code = 'internal_error', status = 500, details, cause } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    if (details) this.details = details;
    if (cause) this.cause = cause;
  }
}

export class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { code: 'invalid_request', status: 400, details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = '资源不存在') {
    super(message, { code: 'not_found', status: 404 });
  }
}

export class UpstreamError extends AppError {
  constructor(message, { service = 'upstream', cause, status = 502 } = {}) {
    super(message, { code: `${service}_error`, status, cause });
    this.service = service;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = '上游鉴权失败，请检查 WEREAD_API_KEY') {
    super(message, { code: 'upstream_unauthorized', status: 401 });
  }
}