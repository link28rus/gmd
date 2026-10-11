/**
 * Долгоживущая («rolling») сессия кабинета.
 *
 * Cookie `gmd_refresh` переставляется на каждом успешном `/auth/refresh`
 * (см. route-хендлеры в `app/api/auth/*`), поэтому активный пользователь
 * остаётся залогинен без повторного ввода пароля.
 *
 * Абсолютный TTL cookie синхронизирован с `REFRESH_TOKEN_TTL_SECONDS` на
 * backend (60 дней). Если с этого устройства не заходили дольше 60 дней —
 * и cookie в браузере, и серверный refresh-токен истекают одновременно,
 * и требуется повторный вход.
 */
export const REFRESH_COOKIE = 'gmd_refresh';

/** 60 дней в секундах. Держать в согласии с backend `REFRESH_TOKEN_TTL_SECONDS`. */
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 60;

/**
 * Временный сбой refresh (сеть, 429, 5xx): сессия жива, cookie на месте. Все
 * экраны при неудаче уходят на /login, а /login при cookie возвращает в кабинет —
 * получался бесконечный цикл, пока сервер лежит. Клиент ставит эту отметку на
 * 30 с (refresh-singleflight.ts), и /login показывает «сервер недоступен».
 */
export const REFRESH_UNAVAILABLE_COOKIE = 'gmd_refresh_unavailable';
