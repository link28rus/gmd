# GMD — hardening сервера 192.168.1.23

Runbook по безопасности production-сервера.

## Что сделано в Phase 0.3

| Шаг | Что            | Где                                                                                                               |
| --- | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| T2  | bootstrap      | hostname `gmd-prod`, TZ `Europe/Moscow`, swap 4G, `unattended-upgrades`                                           |
| T5  | SSH ключи      | `ed25519` pubkey в `/root/.ssh/authorized_keys` + `~/.ssh/config` alias `gmd-prod`                                |
| T6  | SSH hardening  | `PasswordAuthentication no`, `PermitRootLogin prohibit-password` (`/etc/ssh/sshd_config.d/99-gmd-hardening.conf`) |
| T7  | UFW + fail2ban | default deny in / allow 22,80,443; jail sshd, maxretry=3, bantime=1h                                              |
| T8  | Docker         | официальный Docker CE repo, overlay2, log rotate 10MB × 3 (`/etc/docker/daemon.json`)                             |

## Текущий inventory

```bash
ssh gmd-prod 'ufw status numbered; echo; systemctl status fail2ban --no-pager -l | head -5; echo; fail2ban-client status sshd'
```

Ожидаем:

- UFW `active`, три правила ALLOW (22, 80, 443), default deny incoming.
- fail2ban `active (running)`, jail sshd с количеством `Currently banned: <N>`.

## Проверить состояние SSH

```bash
# Попытка входа по паролю должна фейлиться
ssh -o PubkeyAuthentication=no -o PasswordAuthentication=yes gmd-prod 'echo x'
# Ожидаемо: Permission denied (publickey).

# Вход по ключу — работает
ssh -o PasswordAuthentication=no gmd-prod 'echo ok'
# Ожидаемо: ok
```

## Добавить нового админа

1. На его dev-машине сгенерировать ключ: `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_gmd`.
2. Получить `id_ed25519_gmd.pub`.
3. На gmd-prod: `cat >> /root/.ssh/authorized_keys` → вставить pubkey.
4. Записать секретный pubkey в memory-compiler: `save_secret` в проект `gmd`.

## Сбросить доступ, если ключ утерян

Только через консоль VMware (не SSH).

1. Открыть VMware Web Console → VM gmd-prod → Console.
2. Залогиниться root + пароль (из memory-compiler → `save_secret` с топиком `SSH creds 192.168.1.23`).
3. Временно вернуть password auth:

```bash
cat > /etc/ssh/sshd_config.d/99-password-restore.conf <<EOF
PasswordAuthentication yes
EOF
sshd -t && systemctl reload ssh
```

4. С dev-машины залить новый ключ:

```bash
ssh-copy-id -i ~/.ssh/id_ed25519_gmd.pub root@192.168.1.23
```

5. Убрать временный файл и перезагрузить SSH:

```bash
rm /etc/ssh/sshd_config.d/99-password-restore.conf
systemctl reload ssh
```

## Проверка fail2ban

```bash
# Список забаненных IP
ssh gmd-prod 'fail2ban-client status sshd'

# Разбанить IP вручную
ssh gmd-prod 'fail2ban-client set sshd unbanip <IP>'
```

## Проверка открытых портов снаружи

С другого хоста:

```bash
nmap -p 1-1024 95.104.240.99
```

Ожидаемо: только 22/80/443 в OPEN (и только если есть проброс на роутере).

## Апдейты системы

`unattended-upgrades` применяет security-патчи автоматически. Принудительный прогон:

```bash
ssh gmd-prod 'sudo unattended-upgrade --debug | tail -20'
```

Перезагрузка после ядра-апдейта:

```bash
ssh gmd-prod 'ls /var/run/reboot-required 2>/dev/null && echo "REBOOT NEEDED"'
# если нужно:
ssh gmd-prod 'reboot'
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
