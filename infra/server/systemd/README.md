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
