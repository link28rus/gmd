plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // v0.46: применяем google-services plugin (читает google-services.json,
    // генерирует Firebase config classes для FirebaseMessaging init).
    id("com.google.gms.google-services")
}

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
    }

    buildTypes {
        release {
            // TODO: добавить настоящий signingConfig для prod-релиза.
            // Пока подписывается debug-ключом, чтобы `flutter run --release` работал.
            signingConfig = signingConfigs.getByName("debug")
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
