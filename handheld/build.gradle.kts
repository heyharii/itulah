plugins {
    id("com.android.application") version "8.5.2" apply false
    // Kotlin 2 (K2). 2.0.21 is inside what AGP 8.5 and Gradle 8.7 fully support.
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    // From Kotlin 2.0 the Compose compiler ships with Kotlin, at Kotlin's own
    // version, instead of as androidx.compose.compiler pinned to one Kotlin
    // release. From 2.0.20 it compiles in strong skipping mode by default: see
    // app/build.gradle.kts.
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}
