# systemd units для gmd-prod

Файлы в этой директории деплоятся на `/etc/systemd/system/` сервера.

## gmd-disk-heartbeat (push-метрика диска в Uptime Kuma)

Раз в 5 минут шлёт в Uptime Kuma push-monitor «disk-space /opt/gmd/data»
текущий процент использования. Если ≥ 90% (THRESHOLD_PCT) — статус DOWN,
Uptime Kuma уведомит в Telegram.

### Установка

```bash
# С локальной машины
scp infra/server/bin/disk-heartbeat.sh gmd-prod:/tmp/
scp infra/server/systemd/gmd-disk-heartbeat.{service,timer} gmd-prod:/tmp/

# На сервере
ssh gmd-prod
sudo install -m 0755 -o root -g root /tmp/disk-heartbeat.sh /opt/gmd/bin/disk-heartbeat.sh
sudo install -m 0644 -o root -g root /tmp/gmd-disk-heartbeat.service /etc/systemd/system/
sudo install -m 0644 -o root -g root /tmp/gmd-disk-heartbeat.timer /etc/systemd/system/

# Конфиг с push-token (НЕ коммитим в git):
sudo tee /etc/default/gmd-disk-heartbeat >/dev/null <<'EOF'
KUMA_PUSH_URL=http://localhost:3001/api/push/<TOKEN>
THRESHOLD_PCT=90
MOUNT=/opt/gmd/data
EOF
sudo chmod 600 /etc/default/gmd-disk-heartbeat

sudo systemctl daemon-reload
sudo systemctl enable --now gmd-disk-heartbeat.timer
sudo systemctl start gmd-disk-heartbeat.service  # тест-пинг сразу
```

Token берётся из Uptime Kuma → Monitor «disk-space /opt/gmd/data» →
Push URL (формат `/api/push/<TOKEN>`).

## gmd-cleanup (weekly Docker GC)

Раз в неделю чистит unused Docker images / build cache старше 72 часов.
**Не трогает** volumes (`--volumes=false`) и активные контейнеры (Docker сам
защищает referenced images).

### Установка

```bash
# С локальной машины
scp infra/server/systemd/gmd-cleanup.{service,timer} gmd-prod:/tmp/

# На сервере
ssh gmd-prod
sudo install -m 0644 -o root -g root /tmp/gmd-cleanup.service /etc/systemd/system/
sudo install -m 0644 -o root -g root /tmp/gmd-cleanup.timer   /etc/systemd/system/
sudo touch /var/log/gmd-cleanup.log && sudo chmod 644 /var/log/gmd-cleanup.log
sudo systemctl daemon-reload
sudo systemctl enable --now gmd-cleanup.timer
```

### Проверка

```bash
# Когда следующий запуск
systemctl list-timers gmd-cleanup.timer

# Запустить руками сейчас (test)
sudo systemctl start gmd-cleanup.service

# Лог
tail -50 /var/log/gmd-cleanup.log
```

## gmd-geoip-update (monthly GeoIP DB, v0.64.0)

Раз в месяц (3-го, 05:15) скачивает базу DB-IP City Lite в `/opt/gmd/data/geoip/`
(временный файл + `mv -f`). Скрипт — `infra/server/bin/geoip-update.sh`, установка и
проверка — `docs/deploy.md`, раздел «GeoIP — город по IP».

## gmd-osrm-update (граф дорог для привязки треков, v0.80.0)

Раз в месяц качает выгрузку OSM «Дальневосточный ФО» с Geofabrik, вырезает
прямоугольник города (`OSRM_BBOX`, по умолчанию Хабаровск с пригородами) и
собирает два графа OSRM — `car` и `foot` — в `/opt/gmd/osrm/current`. Прежний
граф остаётся в `/opt/gmd/osrm/previous`. После подмены перезапускает
`gmd-osrm-car` / `gmd-osrm-foot`. Карта не менялась — сборка пропускается
(`OSRM_FORCE=1` — собрать всё равно).

Ездите за пределы прямоугольника — расширьте его в `/etc/default/gmd-osrm-update`
(`OSRM_BBOX=minlon,minlat,maxlon,maxlat`) и запустите сервис руками. Весь
Дальний Восток на 8 ГБ памяти не собрать.

### Установка

```bash
# С локальной машины
scp infra/server/bin/osrm-update.sh gmd-prod:/tmp/
scp infra/server/systemd/gmd-osrm-update.{service,timer} gmd-prod:/tmp/

# На сервере
ssh gmd-prod
sudo install -m 0755 -o root -g root /tmp/osrm-update.sh /opt/gmd/bin/osrm-update.sh
sudo install -m 0644 -o root -g root /tmp/gmd-osrm-update.service /etc/systemd/system/
sudo install -m 0644 -o root -g root /tmp/gmd-osrm-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gmd-osrm-update.timer
sudo systemctl start gmd-osrm-update.service   # первая сборка, ~10–20 мин
tail -f /var/log/gmd-osrm-update.log
```
