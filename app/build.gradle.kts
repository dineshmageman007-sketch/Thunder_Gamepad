plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Bundle the repo's layouts/ folder into the APK (assets/layouts/*.json + a generated index.json the app reads on start)
val layoutAssetsDir = layout.buildDirectory.dir("generated/layoutAssets")
val bundleLayouts by tasks.registering(Copy::class) {
    from(rootProject.file("layouts")) {
        include("*.json")
        into("layouts")
    }
    into(layoutAssetsDir)
    doLast {
        val dir = File(layoutAssetsDir.get().asFile, "layouts")
        dir.mkdirs()
        val names = (dir.listFiles() ?: emptyArray<File>()).filter { it.extension.equals("json", true) && it.name != "index.json" }.map { it.name }.sorted()
        File(dir, "index.json").writeText(names.joinToString(",", "[", "]") { "\"" + it.replace("\"", "") + "\"" })
    }
}

android {
    namespace = "com.padlink.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.padlink.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets.getByName("main").assets.srcDir(layoutAssetsDir.get().asFile)
}

tasks.named("preBuild") { dependsOn(bundleLayouts) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
