#!/usr/bin/env python3
"""
Bootstrap Uptime Kuma через Socket.IO API (обходит UI setup wizard).

Запуск с dev-машины при открытом SSH-туннеле `ssh -L 3011:127.0.0.1:3001 gmd-prod`:
  pip install uptime-kuma-api
  python infra/server-setup/scripts/kuma-bootstrap.py

Secrets читаются из env:
  KUMA_URL                 (default http://127.0.0.1:3011)
  KUMA_ADMIN_USER          (default admin)
  KUMA_ADMIN_PASSWORD      (генерируется если не задан)
  TELEGRAM_BOT_TOKEN       (required для Telegram channel)
  TELEGRAM_ADMIN_CHAT_ID   (required)
  SMTP_HOST                (default smtp.yandex.ru)
  SMTP_PORT                (default 465)
  SMTP_USER, SMTP_PASS     (required для email channel)
  SMTP_TO                  (default link28rus@gmail.com)

Идемпотентен: повторный запуск не дублирует мониторы/notifications.
"""

import os
import secrets
import sys
import time

from uptime_kuma_api import UptimeKumaApi, MonitorType, NotificationType  # type: ignore


KUMA_URL = os.environ.get("KUMA_URL", "http://127.0.0.1:3011")
ADMIN_USER = os.environ.get("KUMA_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("KUMA_ADMIN_PASSWORD") or secrets.token_urlsafe(18)


def ensure_setup(api: UptimeKumaApi) -> None:
    if api.need_setup():
        print(f"[setup] creating admin user '{ADMIN_USER}'")
        api.setup(ADMIN_USER, ADMIN_PASSWORD)
        time.sleep(1)
    else:
        print("[setup] already done, logging in")


def find_notification(api: UptimeKumaApi, name: str):
    for n in api.get_notifications():
        if n.get("name") == name:
            return n
    return None


def ensure_telegram(api: UptimeKumaApi) -> int | None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_ADMIN_CHAT_ID")
    if not token or not chat_id:
        print("[telegram] skip — TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID not set")
        return None
    name = "telegram-primary"
    existing = find_notification(api, name)
    if existing:
        print(f"[telegram] already exists id={existing['id']}")
        return existing["id"]
    result = api.add_notification(
        name=name,
        type=NotificationType.TELEGRAM,
        isDefault=False,
        applyExisting=False,
        telegramBotToken=token,
        telegramChatID=chat_id,
    )
    nid = result.get("id") or result.get("notificationID") or result
    print(f"[telegram] created id={nid}")
    return nid


def ensure_email(api: UptimeKumaApi) -> int | None:
    host = os.environ.get("SMTP_HOST", "smtp.yandex.ru")
    port = int(os.environ.get("SMTP_PORT", "465"))
    user = os.environ.get("SMTP_USER")
    pw = os.environ.get("SMTP_PASS")
    to = os.environ.get("SMTP_TO", "link28rus@gmail.com")
    if not user or not pw:
        print("[email] skip — SMTP_USER / SMTP_PASS not set")
        return None
    name = "email-fallback"
    existing = find_notification(api, name)
    if existing:
        print(f"[email] already exists id={existing['id']}")
        return existing["id"]
    result = api.add_notification(
        name=name,
        type=NotificationType.SMTP,
        isDefault=False,
        applyExisting=False,
        smtpHost=host,
        smtpPort=port,
        smtpSecure=True,
        smtpUsername=user,
        smtpPassword=pw,
        smtpFrom=f"GMD Alerts <{user}>",
        smtpTo=to,
    )
    nid = result.get("id") or result.get("notificationID") or result
    print(f"[email] created id={nid}")
    return nid


def find_monitor(api: UptimeKumaApi, name: str):
    for m in api.get_monitors():
        if m.get("name") == name:
            return m
    return None


def ensure_docker_host(api: UptimeKumaApi) -> int:
    """Создаёт (или возвращает существующий) docker-host для local socket."""
    target_name = "local-docker"
    for h in api.get_docker_hosts():
        if h.get("name") == target_name:
            print(f"[docker-host] '{target_name}' exists id={h['id']}")
            return h["id"]
    result = api.add_docker_host(
        name=target_name,
        dockerType="socket",
        dockerDaemon="/var/run/docker.sock",
    )
    hid = result.get("id") or result.get("dockerHostID") or result
    print(f"[docker-host] '{target_name}' created id={hid}")
    return hid


def ensure_monitor(api: UptimeKumaApi, *, name: str, notification_ids: list[int], **kwargs):
    existing = find_monitor(api, name)
    if existing:
        print(f"[monitor] '{name}' already exists id={existing['id']}")
        return existing["id"]
    notifications = {nid: True for nid in notification_ids if nid}
    result = api.add_monitor(name=name, notificationIDList=notifications, **kwargs)
    mid = result.get("id") or result.get("monitorID") or result
    print(f"[monitor] '{name}' created id={mid}")
    return mid


def main() -> int:
    api = UptimeKumaApi(KUMA_URL, timeout=30, wait_events=1.0)
    try:
        ensure_setup(api)
        api.login(ADMIN_USER, ADMIN_PASSWORD)

        tg = ensure_telegram(api)
        em = ensure_email(api)
        docker_host_id = ensure_docker_host(api)

        warn_chans = [nid for nid in (tg,) if nid]
        crit_chans = [nid for nid in (tg, em) if nid]

        # 1. Caddy edge
        ensure_monitor(
            api,
            name="Caddy edge (/healthz)",
            type=MonitorType.HTTP,
            url="https://gmd.link28rus.ru/healthz",
            interval=60,
            maxretries=2,
            notification_ids=warn_chans,
        )
        # 2. Web healthz
        ensure_monitor(
            api,
            name="Web healthz",
            type=MonitorType.HTTP,
            url="https://gmd.link28rus.ru/api/healthz",
            interval=60,
            maxretries=2,
            notification_ids=warn_chans,
        )
        # 3. Backend readyz (critical, keyword)
        ensure_monitor(
            api,
            name="Backend readyz",
            type=MonitorType.KEYWORD,
            url="https://gmd.link28rus.ru/api/readyz",
            keyword='"status":"ok"',
            interval=60,
            maxretries=2,
            notification_ids=crit_chans,
        )
        # 4. Postgres docker
        ensure_monitor(
            api,
            name="gmd-postgres container",
            type=MonitorType.DOCKER,
            docker_container="gmd-postgres",
            docker_host=docker_host_id,
            interval=120,
            maxretries=1,
            notification_ids=crit_chans,
        )
        # 5. Redis docker
        ensure_monitor(
            api,
            name="gmd-redis container",
            type=MonitorType.DOCKER,
            docker_container="gmd-redis",
            docker_host=docker_host_id,
            interval=120,
            maxretries=1,
            notification_ids=crit_chans,
        )
        # 6. TLS cert expiry (использует встроенный HTTP monitor + expiry alerts)
        ensure_monitor(
            api,
            name="TLS cert gmd.link28rus.ru",
            type=MonitorType.HTTP,
            url="https://gmd.link28rus.ru/",
            interval=86400,
            maxretries=1,
            expiryNotification=True,
            notification_ids=warn_chans,
        )
        # 7. Disk-space push
        disk = ensure_monitor(
            api,
            name="disk-space /opt/gmd/data",
            type=MonitorType.PUSH,
            interval=300,
            maxretries=3,
            notification_ids=warn_chans,
        )
        # 8. PG-backup push heartbeat
        pgbak = ensure_monitor(
            api,
            name="pg-backup heartbeat",
            type=MonitorType.PUSH,
            interval=86400,
            maxretries=0,
            notification_ids=crit_chans,
        )

        # Извлекаем push-URL для heartbeat'ов
        print()
        print("=== PUSH URLs для /opt/gmd/.env.prod ===")
        for mid, env_key in ((disk, "KUMA_DISK_HEARTBEAT_URL"), (pgbak, "KUMA_BACKUP_HEARTBEAT_URL")):
            if isinstance(mid, int):
                m = api.get_monitor(mid)
                token = m.get("pushToken")
                if token:
                    # kuma push URL — внутри docker-сети
                    url = f"http://uptime-kuma:3001/api/push/{token}?status=up&msg=OK&ping="
                    print(f"{env_key}={url}")

        print()
        print(f"KUMA_ADMIN_USER={ADMIN_USER}")
        print(f"KUMA_ADMIN_PASSWORD={ADMIN_PASSWORD}")
        return 0
    finally:
        api.disconnect()


if __name__ == "__main__":
    sys.exit(main())
