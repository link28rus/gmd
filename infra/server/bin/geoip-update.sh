#!/usr/bin/env bash
# Обновление базы GeoIP для gmd-backend (v0.64.0, «город по IP» — запасной
# центр карты в кабинете).
#
# База: DB-IP City Lite (CC BY 4.0, атрибуция «IP Geolocation by DB-IP»),
# зеркало GitHub Releases проекта sapics/ip-location-db. Официальный сайт
# DB-IP с сервера режется (Cloudflare: ~20 КБ и обрыв), зеркало качается за
# секунды.
#
# Файл сначала качается во временный в ТОМ ЖЕ каталоге, проверяется (размер +
# маркер метаданных MaxMind DB) и только потом mv -f на место — атомарная
# замена. Backend видит каталог через bind-mount :ro и подхватывает новую базу
# сам (maxmind watchForUpdates), рестарт не нужен.
set -euo pipefail

DIR="${GEOIP_DIR:-/opt/gmd/data/geoip}"
BASE_URL="${GEOIP_BASE_URL:-https://github.com/sapics/ip-location-db/releases/download/latest}"
# Живые файлы ~60–70 МБ; меньше 20 МБ — точно обрыв или страница ошибки.
MIN_BYTES="${GEOIP_MIN_BYTES:-20000000}"
FILES=(dbip-city-ipv4.mmdb dbip-city-ipv6.mmdb)

mkdir -p "$DIR"
TMP=""
cleanup() { [ -n "$TMP" ] && rm -f "$TMP"; return 0; }
trap cleanup EXIT

for f in "${FILES[@]}"; do
  TMP="$(mktemp "$DIR/.${f}.XXXXXX")"
  echo "geoip: качаю $f"
  curl -fsSL --retry 3 --retry-delay 10 --connect-timeout 20 --max-time 900 \
    -o "$TMP" "$BASE_URL/$f"

  size="$(stat -c %s "$TMP")"
  if [ "$size" -lt "$MIN_BYTES" ]; then
    echo "geoip: $f слишком мал ($size байт) — оставляю прежнюю базу" >&2
    exit 1
  fi
  # Метаданные MaxMind DB лежат в последних 128 КиБ файла.
  if ! tail -c 131072 "$TMP" | grep -aq 'MaxMind.com'; then
    echo "geoip: $f не похож на MaxMind DB — оставляю прежнюю базу" >&2
    exit 1
  fi

  chmod 0644 "$TMP"
  mv -f "$TMP" "$DIR/$f"
  TMP=""
  echo "geoip: $f обновлён ($size байт)"
done

echo "=== geoip-update finished $(date -Iseconds) ==="
