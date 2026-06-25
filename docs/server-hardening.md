# Перископ — hardening сервера 45.67.230.87 (periscop.pro)

Runbook по безопасности production-сервера Перископа. Сервер развёрнут в task #67
(миграция с прежнего dual-WAN сервера 192.168.1.23 / 95.104.240.111 на перенос домена с gmd-online.ru на periscop.pro).

## Базовая конфигурация (выполнено в task #67)

| Слой        | Что                                                                                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OS          | Ubuntu 24.04.4 LTS, kernel 6.8                                                                                                                                       |
| `apt`       | `unattended-upgrades` enabled (только security-источник, без auto-reboot)                                                                                            |
| SSH         | key-only: `PasswordAuthentication no`, `PermitRootLogin prohibit-password`, `PubkeyAuthentication yes`. Алиас `gmd-online` в `~/.ssh/config`                         |
| User        | non-root `gmd` (uid 1000, в группах `sudo`, `docker`), NOPASSWD-sudo. Тот же SSH-ключ что у root, с `chmod 700` на `~/.ssh`                                          |
| UFW         | default deny-incoming/allow-outgoing. Открыты: `22/tcp ssh`, `80/tcp http`, `443/tcp https`. enabled                                                                 |
| fail2ban    | jail `sshd`, `maxretry=5`, `findtime=10m`, `bantime=1h` (через `/etc/fail2ban/jail.d/sshd.local`)                                                                    |
| Docker      | Docker CE 29.x + compose-plugin 5.x (официальный репозиторий `download.docker.com`)                                                                                  |
| `/opt/gmd/` | Структура `{docker,backups/postgres,backups/migration-2026-05-15,download,secrets,letsencrypt,logs,data,caddy,apps,packages}`, owner `gmd:gmd`, `secrets/` chmod 700 |

## Текущий inventory

```bash
ssh gmd-online 'ufw status numbered; echo; systemctl status fail2ban --no-pager -l | head -5; echo; fail2ban-client status sshd'
```

Ожидаем:

- UFW `active`, три правила ALLOW (22, 80, 443), default deny incoming.
- fail2ban `active (running)`, jail sshd с количеством `Currently banned: <N>`.

## Проверить состояние SSH

```bash
# Попытка входа по паролю должна фейлиться
ssh -o PubkeyAuthentication=no -o PasswordAuthentication=yes gmd-online 'echo x'
# Ожидаемо: Permission denied (publickey).

# Вход по ключу — работает
ssh -o PasswordAuthentication=no gmd-online 'echo ok'
# Ожидаемо: ok
```

## Добавить нового админа

1. На его dev-машине сгенерировать ключ: `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_gmd`.
2. Получить `id_ed25519_gmd.pub`.
3. На gmd-online: `cat >> /root/.ssh/authorized_keys` → вставить pubkey.
4. Записать секретный pubkey в memory-compiler: `save_secret` в проект `gmd`.

## Сбросить доступ, если ключ утерян

Только через веб-консоль VPS-провайдера (не SSH).

1. Открыть VNC/serial-консоль VPS в панели хостинга.
2. Залогиниться root + пароль (из memory-compiler → `save_secret` с топиком `SSH creds 45.67.230.87`).
3. Временно вернуть password auth:

```bash
cat > /etc/ssh/sshd_config.d/99-password-restore.conf <<EOF
PasswordAuthentication yes
EOF
sshd -t && systemctl reload ssh
```

4. С dev-машины залить новый ключ:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519_gmd.pub root@45.67.230.87
```

5. Убрать временный файл и перезагрузить SSH:

```bash
rm /etc/ssh/sshd_config.d/99-password-restore.conf
systemctl reload ssh
```

## Проверка fail2ban

```bash
# Список забаненных IP
ssh gmd-online 'fail2ban-client status sshd'

# Разбанить IP вручную
ssh gmd-online 'fail2ban-client set sshd unbanip <IP>'
```

## Проверка открытых портов снаружи

С другого хоста:

```bash
nmap -p 1-1024 45.67.230.87
```

Ожидаемо: только 22/80/443 в OPEN. VPS подключён прямо к публичному IP без NAT,
поэтому что разрешено в UFW — то и видно снаружи.

## Апдейты системы

`unattended-upgrades` применяет security-патчи автоматически. Принудительный прогон:

```bash
ssh gmd-online 'sudo unattended-upgrade --debug | tail -20'
```

Перезагрузка после ядра-апдейта:

```bash
ssh gmd-online 'ls /var/run/reboot-required 2>/dev/null && echo "REBOOT NEEDED"'
# если нужно:
ssh gmd-online 'reboot'
```

## Секреты

Хранятся:

- `/opt/gmd/.env.prod` — 600 root, не в git.
- memory-compiler → `save_secret` project `gmd` — зашифрованные SSH/DB/API креды.

**Никогда не коммитить** `.env.prod`, `id_ed25519*` приватные ключи, SSH-passwords.

## Файлы

- `infra/server-setup/00-bootstrap.sh`
- `infra/server-setup/10-harden-ssh.sh`
- `infra/server-setup/20-firewall.sh`
- `infra/server-setup/30-install-docker.sh`
- `infra/server-setup/40-backups-install.sh`
- `/etc/ssh/sshd_config.d/99-gmd-hardening.conf` (на сервере)
- `/etc/fail2ban/jail.local` (на сервере)
