// Здесь будут типы, генерируемые из OpenAPI-spec backend'а.
// Добавляется в Phase 1 (Backend core) через openapi-typescript.

export type ApiErrorCode = 'INVALID_INVITE' | 'DEVICE_NOT_LINKED' | 'RATE_LIMITED' | 'UNAUTHORIZED';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}
