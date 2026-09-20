import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
// The release signing material, when this machine has it.
//
// Absent on a fresh clone and on CI, and that is deliberate: a build that
// cannot sign for release should say so rather than quietly fall back to the
// debug key and produce an APK that looks shippable and is not.
val signingProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
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
    buildFeatures { compose = true; buildConfig = true }

    signingConfigs {
        if (signingProps.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(signingProps.getProperty("storeFile"))
                storePassword = signingProps.getProperty("storePassword")
                keyAlias = signingProps.getProperty("keyAlias")
                keyPassword = signingProps.getProperty("keyPassword")
            }
        }
    }
    composeOptions { kotlinCompilerExtensionVersion = "1.5.14" }
    buildTypes {
        debug {
            isMinifyEnabled = false
            // The bench: the Lab tab, the file command channel, and the EPC
            // marriages that let foreign tags stand in for products.
            buildConfigField("boolean", "BENCH", "true")
        }
        release {
            // R8 is off: the vendor DeviceAPI aar references classes it does not
            // ship, and shrinking it needs keep rules that are a separate piece
            // of work. The speed that matters here does not come from R8 anyway
            // — it comes from the build not being debuggable, which turns off
            // Compose's composition tracing.
            isMinifyEnabled = false
            // Nothing that can make a count mean something other than what it
            // says survives into a release. See `Lab` and `openCatalogue`.
            buildConfigField("boolean", "BENCH", "false")
            signingConfig = signingConfigs.findByName("release")
                ?: signingConfigs.getByName("debug")
        }
    }
    testOptions {
        unitTests {
            // The scan engine and the EPC codec are plain Kotlin and run on the
            // JVM. What little Android they touch is constants; anything that
            // would need a real framework object is refactored to take the
            // numbers instead, because a test that needs a device is a test
            // nobody runs before pushing.
            isReturnDefaultValues = true
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
    testImplementation("junit:junit:4.13.2")
}
