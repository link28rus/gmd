import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // v0.37: применяем google-services plugin (читает google-services.json,
    // генерирует Firebase config classes для FirebaseMessaging init).
    id("com.google.gms.google-services")
}

// Загружаем release-signing конфиг из android/key.properties (в git не хранится).
// Если файла нет — release-build будет невозможен, но debug продолжит работать.
val keystoreProperties = Properties().apply {
    val propsFile = rootProject.file("key.properties")
    if (propsFile.exists()) {
        load(FileInputStream(propsFile))
    }
}

// RuStore Push project id (см. android/rustore.properties.example). Файл
// `rustore.properties` в .gitignore; если его нет — берём пустое значение,
// и RustorePushClient.getToken() при первом запуске вернёт ошибку
// «project id is not provided» (логируем, fallback на FCM).
val rustoreProperties = Properties().apply {
    val propsFile = rootProject.file("rustore.properties")
    if (propsFile.exists()) {
        load(FileInputStream(propsFile))
    }
}
val rustorePushProjectId: String = rustoreProperties.getProperty("rustorePushProjectId", "")

android {
    namespace = "ru.link28rus.gmd.child"
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "ru.link28rus.gmd.child"
        minSdk = 26
        targetSdk = 34
        // Версия берётся из pubspec.yaml (поле `version: X.Y.Z+build`).
        // Flutter-плагин прокидывает её через `flutter.versionCode`
        // / `flutter.versionName`, так что bump pubspec → bump APK.
        versionCode = flutter.versionCode
        versionName = flutter.versionName

        // Подставляется в AndroidManifest meta-data
        // `ru.rustore.sdk.pushclient.project_id` (см. AndroidManifest.xml).
        // Пустая строка допустима для CI без секрета — runtime SDK тогда no-op'нется.
        manifestPlaceholders["rustorePushProjectId"] = rustorePushProjectId
    }

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
            // Если key.properties отсутствует — падаем обратно на debug keys
            // (для CI/локальной сборки без релизного ключа).
            signingConfig = if (keystoreProperties.isNotEmpty()) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    implementation("com.google.android.gms:play-services-location:21.3.0")
    // v0.37: Firebase Cloud Messaging — нужен compile-time доступ к
    // FirebaseMessagingService class из MyFirebaseMessagingService.kt.
    // Через BoM 34.12.0 (выровнен с Firebase Console wizard).
    implementation(platform("com.google.firebase:firebase-bom:34.12.0"))
    implementation("com.google.firebase:firebase-messaging")
    // v0.38 Phase 6.1: WorkManager periodic для UsageStatsReportWorker (15-min)
    // и InstalledAppsReportWorker (daily). Минимальный интервал periodic = 15 мин.
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    // v0.40 auto-update: FileProvider для шаринга скачанного APK системному
    // installer'у. Тянется транзитивно через workmanager, но явно фиксируем —
    // имя класса androidx.core.content.FileProvider используется в манифесте.
    implementation("androidx.core:core-ktx:1.13.1")
    // v0.49 Phase 6.x: unit-тесты для ScheduleEvaluator (parity с backend
    // ScheduleService.isActiveAt). org.json уже доступен в android.jar для
    // unit-тестов через robolectric/inline jar. На JUnit 4 хватает —
    // тесты pure (Instant + ZoneId без Android SDK), запуск через
    // `gradlew :app:testDebugUnitTest`.
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
