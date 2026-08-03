plugins {
    id("com.android.application")
}

val releaseStoreFile = providers.environmentVariable("FINDSPOT_COMPANION_KEYSTORE").orNull
val releaseStorePassword = providers.environmentVariable("FINDSPOT_COMPANION_STORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("FINDSPOT_COMPANION_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("FINDSPOT_COMPANION_KEY_PASSWORD").orNull
val releaseSigningReady = listOf(
    releaseStoreFile,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { !it.isNullOrBlank() }

android {
    namespace = "uk.findspot.companion"
    compileSdk = 35

    defaultConfig {
        applicationId = "uk.findspot.companion"
        minSdk = 26
        targetSdk = 35
        versionCode = 3
        versionName = "1.0.0-beta.3"
    }

    signingConfigs {
        if (releaseSigningReady) {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            if (releaseSigningReady) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

gradle.taskGraph.whenReady {
    val releaseRequested = allTasks.any { task ->
        task.project == project && task.name.contains("Release", ignoreCase = true)
    }
    if (releaseRequested && !releaseSigningReady) {
        throw GradleException(
            "Release signing requires FINDSPOT_COMPANION_KEYSTORE, " +
                "FINDSPOT_COMPANION_STORE_PASSWORD, FINDSPOT_COMPANION_KEY_ALIAS " +
                "and FINDSPOT_COMPANION_KEY_PASSWORD."
        )
    }
}

dependencies {
    implementation("androidx.core:core:1.15.0")
    testImplementation("junit:junit:4.13.2")
}
