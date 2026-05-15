import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // v0.46: применяем google-services plugin (читает google-services.json,
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
    namespace = "ru.link28rus.gmd.gmd_parent"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "ru.link28rus.gmd.gmd_parent"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
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
    // v0.46: Firebase Cloud Messaging для приёма push на родительском устройстве
    // (события геозон, SOS, низкий заряд, ребёнок offline). BoM 34.12.0 как у child.
    implementation(platform("com.google.firebase:firebase-bom:34.12.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.core:core-ktx:1.13.1")
}
