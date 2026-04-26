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
}
