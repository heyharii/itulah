plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "id.itulah.pindai"
    compileSdk = 34
    defaultConfig {
        applicationId = "id.itulah.pindai"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }
    buildFeatures { compose = true }
    composeOptions { kotlinCompilerExtensionVersion = "1.5.14" }
    buildTypes {
        debug { isMinifyEnabled = false }
        // Signed with the debug key on purpose: this exists to measure and to
        // hand to the floor, not to publish. Compose in a debug build carries
        // composition tracing and no R8 — on this hardware that is the whole
        // difference between a list that glides and one that stutters.
        release {
            // R8 is off: the vendor DeviceAPI aar references classes it does not
            // ship, and shrinking it needs keep rules that are a separate piece
            // of work. The speed that matters here does not come from R8 anyway
            // — it comes from the build not being debuggable, which turns off
            // Compose's composition tracing.
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}
dependencies {
    implementation(files("libs/DeviceAPI_ver20251103_release.aar"))
    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
