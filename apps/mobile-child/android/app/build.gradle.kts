import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
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
    compileSdk = 34
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
}
