# Android keystore'ы Перископа

Подпись релизных AAB/APK для mobile-parent и mobile-child. Keystore'ы и пароли НЕ хранятся в git — только локально на машине разработчика и в encrypted memory-compiler.

## Где живут

| App           | Keystore                                            | Конфиг для Gradle                           | Секреты в memory-compiler                                        |
| ------------- | --------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| mobile-parent | `apps/mobile-parent/android/gmd-parent-release.jks` | `apps/mobile-parent/android/key.properties` | `gmd/secret_gmd_mobile-parent_release_keystore___credentials.md` |
| mobile-child  | `apps/mobile-child/android/gmd-child-release.jks`   | `apps/mobile-child/android/key.properties`  | `gmd/secret_gmd_mobile-child_release_keystore___credentials.md`  |

Оба `.jks` файла и `key.properties` покрыты `apps/mobile-{parent,child}/android/.gitignore` (`*.jks`, `*.keystore`, `key.properties`).

## Параметры

| Параметр         | parent                                                                                            | child                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Alias            | `parent`                                                                                          | `periscop-child`                                                                                  |
| Algorithm        | RSA 2048-bit (SHA256withRSA)                                                                      | RSA 2048-bit (SHA256withRSA)                                                                      |
| Validity         | 2026-05-12 → 2053-09-27 (~27 лет)                                                                 | 2026-04-21 → 2056-04-13 (~30 лет)                                                                 |
| DN               | `CN=Перископ Родитель, OU=Перископ, O=link28rus, L=Khabarovsk, ST=Khabarovsky Krai, C=RU`         | `CN=Перископ Ребёнка, OU=Перископ, O=link28rus, L=Khabarovsk, ST=Khabarovsky Krai, C=RU`          |
| SHA-1            | `41:F1:1C:56:4D:4D:E6:2B:E4:A3:33:5F:09:10:C3:44:14:04:79:B0`                                     | `C0:E8:42:8B:08:A6:F5:5C:10:BF:F1:2D:B7:2D:16:07:C7:D6:4D:D2`                                     |
| SHA-256          | `75:32:18:33:C5:32:57:17:25:FB:5D:6B:10:33:8A:EE:DA:03:C5:46:CC:D7:4E:B8:74:B6:4B:B7:BA:80:8D:6A` | `46:43:FB:4D:1B:29:5F:2E:3C:09:8C:BF:3B:CF:9B:CF:9E:D4:9D:A2:A8:19:A4:9F:84:5C:69:70:48:8A:49:C9` |
| Распространялся? | нет (новый, RuStore-only канал для Перископа)                                                     | да — все v0.50.x+ APK Перископа-ребёнка на устройствах подписаны им                               |

**Critical:** child keystore УЖЕ на устройствах пользователей Перископа. Менять его = ломать update path. При публикации в RuStore — использовать именно этот keystore (PEPK ниже).

## Как Gradle подхватывает signing

`build.gradle.kts` обоих apps читает `key.properties` относительно `rootProject` (= `android/`):

```kotlin
val keystoreProperties = Properties().apply {
    val propsFile = rootProject.file("key.properties")
    if (propsFile.exists()) {
        load(FileInputStream(propsFile))
    }
}

android {
    signingConfigs {
        create("release") {
            val storeFileName = keystoreProperties.getProperty("storeFile")
            if (storeFileName != null) {
                storeFile = rootProject.file(storeFileName)
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        release {
            // Если key.properties отсутствует → debug fallback (для CI без ключа)
            signingConfig = if (keystoreProperties.isNotEmpty()) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}
```

Формат `key.properties`:

```
storeFile=gmd-<app>-release.jks
storePassword=<пароль keystore>
keyAlias=<alias>
keyPassword=<пароль alias>
```

**Verify подписи AAB после сборки:**

```bash
unzip -l apps/mobile-<app>/build/app/outputs/bundle/release/app-release.aab | grep RSA
# должно показать один RSA-файл с именем основанным на alias (PARENT.RSA, GMD-CHIL.RSA)
# НЕ ANDROIDD.RSA (это debug)

unzip -p .../app-release.aab META-INF/<ALIAS>.RSA | keytool -printcert | grep -E "Owner|SHA1|SHA256"
# Owner должен быть CN=GMD Parent / CN=GMD Child, не CN=Android Debug
```

## Регенерация keystore (только при потере)

⚠️ Регенерация = смена signing identity. Старые установки приложения через `adb install -r` или auto-update не пройдут (signature mismatch). Эквивалентно публикации нового приложения под новым package'ом. Перед регенерацией — backup существующего `.jks`.

```bash
# Сгенерировать новый password (28 символов alphanumeric)
PASS=$(python -c "import secrets, string; print(''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(28)))")
echo "Сохрани в password manager: $PASS"

# parent
"C:/Program Files/Eclipse Adoptium/jdk-17.0.16.8-hotspot/bin/keytool.exe" -genkeypair -v \
  -keystore D:/Project/GMD/apps/mobile-parent/android/gmd-parent-release.jks \
  -alias parent \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=GMD Parent, OU=GMD, O=link28rus, L=Khabarovsk, ST=Khabarovsky Krai, C=RU"

# child аналогично, alias=gmd-child, CN="GMD Child"
```

## Загрузка signing key в RuStore Console (PEPK flow)

При публикации в формате **AAB** RuStore требует upload зашифрованного private key и public cert через **PEPK** (Play Encrypted Private Key — стандарт Google Play, RuStore переиспользует протокол).

Шаги (для каждого app отдельно):

1. **В Console** → app → раздел «Подпись приложения» → «Загрузить подпись».
2. Скачать `pepk.jar` (кнопка в диалоге).
3. Запустить:
   ```bash
   java -jar pepk.jar \
     --keystore=apps/mobile-<app>/android/gmd-<app>-release.jks \
     --alias=<alias> \
     --output=/tmp/gmd-<app>-pepk.zip \
     --include-cert=/tmp/gmd-<app>-upload-cert.pem \
     --rsa-aes-encryption \
     --encryption-key-path=<путь к публичному ключу шифрования RuStore из диалога>
   ```
   (точная команда — в диалоге Console «Запустите инструмент с помощью команды»)
4. Загрузить `.zip` (≤100 KB) в поле «3. Загрузите созданный ZIP-архив».
5. Загрузить `.pem` (≤100 KB) в поле «4. Загрузите сертификат загрузки».
6. Нажать «Отправить подпись».

После этого RuStore ассоциирует наш keystore с приложением и сможет принимать AAB подписанные им же.

## Backup-обязательства

| Что                                  | Куда                                              | Кто отвечает                      |
| ------------------------------------ | ------------------------------------------------- | --------------------------------- |
| `gmd-parent-release.jks` файл        | внешний диск / шифрованное облачное хранилище     | разработчик (link28rus@gmail.com) |
| `gmd-child-release.jks` файл         | то же                                             | то же                             |
| Пароли (storePassword + keyPassword) | персональный password-manager                     | разработчик                       |
| Backup credentials в memory-compiler | encrypted via `mcp__memory-compiler__save_secret` | автоматически по факту изменения  |

При смене рабочего ПК — восстановить оба `.jks` + `key.properties` рядом из backup'а; сборка release-build в этот момент должна пройти без правок репо.

## Связанное

- [.claude/skills/gmd-deploy/SKILL.md](.claude/skills/gmd-deploy/SKILL.md) — релизный flow, шаг 5а «Build AAB».
- CLAUDE.md lessons #12, #14, #16 — гарантии подписи, naming, verify endpoint.
- CLAUDE.md lessons #23, #24 — почему именно RuStore (permission preservation, GPP signal).
- memory-compiler `gmd/secret_gmd_mobile-{parent,child}_release_keystore___credentials.md` — encrypted credentials backup.
