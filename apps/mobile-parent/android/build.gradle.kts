allprojects {
    repositories {
        google()
        mavenCentral()
        // RuStore SDKs (flutter_rustore_push, flutter_rustore_update) тянут
        // нативные артефакты `ru.rustore.sdk:*` отсюда — внешнее зеркало VK
        // Partner-репозитория, единственный публичный mirror.
        maven {
            url = uri("https://artifactory-external.vkpartner.ru/artifactory/maven")
        }
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
