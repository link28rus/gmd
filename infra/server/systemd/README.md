# systemd units для gmd-prod

Файлы в этой директории деплоятся на `/etc/systemd/system/` сервера.

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
