# R8 rules for the release build.
#
# R8 IS OFF: `isMinifyEnabled = false` in app/build.gradle.kts. These rules are
# prepared for the day it is switched on, and that day comes only after a
# release built with them has swept, filed and received on a real C5 — nothing
# but the hardware can prove the vendor SDK survives shrinking.
#
# Kotlin, coroutines, Compose and the rest of AndroidX need nothing here: AGP's
# proguard-android-optimize.txt and the consumer rules those libraries ship
# inside their own artifacts already cover them. The vendor AAR ships none,
# which is what this file is for.

# The Chainway DeviceAPI (DeviceAPI_ver20251103_release.aar), whole and under
# its own names. Its native libraries (libDeviceAPIM.so, libDeviceAPIQ.so,
# libIDFingerprintAlg.so) bind to these classes and call back into them by
# name over JNI, and the SDK reflects on itself; a renamed or removed member
# fails at runtime on the device, never at build time.
-keep class com.rscja.** { *; }

# The one class the AAR references that no artifact provides — found with
# `jdeps` against android-34's android.jar. It is a hidden framework class the
# SDK reads system properties through: present on the device, absent from the
# public SDK that R8 checks against, so it is a warning to silence, not a gap.
-dontwarn android.os.SystemProperties

# Not a code rule, but the next trap: if resource shrinking is ever switched on
# as well (isShrinkResources), `Sounder` finds its clip by NAME through
# getIdentifier("scan_beep", "raw", …), which the shrinker cannot see. Keep it
# with a tools:keep entry in res/raw/keep.xml first.
