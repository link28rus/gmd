#!/usr/bin/env bash
# Сборка дорожного графа OSRM для привязки треков к дорогам (v0.80.0).
#
# Два графа из одной карты OSM: car (транспорт) и foot (пешком). Контейнеры
# gmd-osrm-car / gmd-osrm-foot читают их из $OSRM_DIR/current/{car,foot}.
#
# Карта — выгрузка Geofabrik «Дальневосточный ФО» (~400 МБ), из неё osmium
# вырезает прямоугольник OSRM_BBOX вокруг города семьи: целиком регион на
# сервере с 8 ГБ памяти не подготовить, а ездят все в пределах города.
# Ездите шире — расширьте OSRM_BBOX (minlon,minlat,maxlon,maxlat).
#
# Сборка идёт в $OSRM_DIR/next, проверяется, и только потом подменяет
# current (прежний граф остаётся в previous). Контейнеры держат каталог по
# inode, поэтому после подмены их перезапускаем — без этого читали бы старый.
set -euo pipefail

OSRM_DIR="${OSRM_DIR:-/opt/gmd/osrm}"
PBF_URL="${OSRM_PBF_URL:-https://download.geofabrik.de/russia/far-eastern-fed-district-latest.osm.pbf}"
BBOX="${OSRM_BBOX:-134.3,47.9,136.3,49.2}"
IMAGE="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v6.0.0}"
# Подготовка — фоновая работа на живом сервере: не больше двух ядер.
THREADS="${OSRM_THREADS:-2}"
# Потолок памяти каждого контейнера сборки. Swap на сервере нет: без лимита
# вылет за память — глобальный OOM, под который может попасть прод
# (2026-10-09 osmium в стратегии по умолчанию съел 3.4 ГБ и был убит ядром).
MEM="${OSRM_BUILD_MEM:-2g}"
# Живая выгрузка ~400 МБ; меньше 100 МБ — обрыв или страница ошибки.
MIN_BYTES="${OSRM_MIN_BYTES:-100000000}"
PROFILES=(car foot)
CONTAINERS=(gmd-osrm-car gmd-osrm-foot)

SRC="$OSRM_DIR/src"
NEXT="$OSRM_DIR/next"
mkdir -p "$SRC"
TMP=""
cleanup() { [ -n "$TMP" ] && rm -f "$TMP"; rm -rf "$NEXT"; return 0; }
trap cleanup EXIT

# 1. Карта. -z — качать, только если на Geofabrik новее нашей копии.
FULL="$SRC/full.osm.pbf"
TMP="$(mktemp "$SRC/.full.XXXXXX")"
echo "osrm: проверяю карту $PBF_URL"
if [ -f "$FULL" ]; then
  curl -fsSL --retry 3 --retry-delay 10 --connect-timeout 20 --max-time 3600 \
    -z "$FULL" -o "$TMP" "$PBF_URL"
else
  curl -fsSL --retry 3 --retry-delay 10 --connect-timeout 20 --max-time 3600 \
    -o "$TMP" "$PBF_URL"
fi
if [ -s "$TMP" ]; then
  size="$(stat -c %s "$TMP")"
  if [ "$size" -lt "$MIN_BYTES" ]; then
    echo "osrm: выгрузка слишком мала ($size байт) — оставляю прежний граф" >&2
    exit 1
  fi
  mv -f "$TMP" "$FULL"
  TMP=""
  echo "osrm: карта обновлена ($size байт)"
elif [ "${OSRM_FORCE:-0}" != "1" ] && [ -d "$OSRM_DIR/current" ] \
  && [ "$(cat "$OSRM_DIR/current/bbox" 2>/dev/null)" = "$BBOX" ]; then
  echo "osrm: карта не менялась, граф актуален"
  exit 0
fi

# 2. Вырезаем прямоугольник города.
echo "osrm: вырезаю $BBOX"
# Стратегия simple — один проход без индекса координат всех точек региона
# (complete_ways держит его в памяти: ~3.5 ГБ на выгрузку ДФО). Дороги на
# краю прямоугольника обрезаются — для города с запасом по краям не важно.
docker run --rm --memory "$MEM" -v "$SRC:/src" debian:bookworm-slim sh -c "
  apt-get update -qq >/dev/null && apt-get install -y -qq osmium-tool >/dev/null &&
  osmium extract --overwrite --strategy simple -b '$BBOX' /src/full.osm.pbf -o /src/region.osm.pbf"
[ -s "$SRC/region.osm.pbf" ] || { echo "osrm: вырезка пуста" >&2; exit 1; }
echo "osrm: вырезано $(stat -c %s "$SRC/region.osm.pbf") байт"

# 3. Графы: extract → partition → customize (алгоритм MLD).
rm -rf "$NEXT"
for p in "${PROFILES[@]}"; do
  echo "osrm: собираю граф $p"
  mkdir -p "$NEXT/$p"
  cp "$SRC/region.osm.pbf" "$NEXT/$p/region.osm.pbf"
  docker run --rm --memory "$MEM" -v "$NEXT/$p:/data" "$IMAGE" \
    osrm-extract -t "$THREADS" -p "/opt/$p.lua" /data/region.osm.pbf
  docker run --rm --memory "$MEM" -v "$NEXT/$p:/data" "$IMAGE" \
    osrm-partition -t "$THREADS" /data/region.osrm
  docker run --rm --memory "$MEM" -v "$NEXT/$p:/data" "$IMAGE" \
    osrm-customize -t "$THREADS" /data/region.osrm
  rm -f "$NEXT/$p/region.osm.pbf"
  [ -s "$NEXT/$p/region.osrm.mldgr" ] || { echo "osrm: граф $p не собрался" >&2; exit 1; }
done
echo "$BBOX" > "$NEXT/bbox"

# 4. Подмена: next → current, прежний → previous.
rm -rf "$OSRM_DIR/previous"
[ -d "$OSRM_DIR/current" ] && mv "$OSRM_DIR/current" "$OSRM_DIR/previous"
mv "$NEXT" "$OSRM_DIR/current"
chmod -R a+rX "$OSRM_DIR/current"

for c in "${CONTAINERS[@]}"; do
  if docker inspect "$c" >/dev/null 2>&1; then
    docker restart "$c" >/dev/null && echo "osrm: перезапущен $c"
  fi
done

echo "=== osrm-update finished $(date -Iseconds) ==="
