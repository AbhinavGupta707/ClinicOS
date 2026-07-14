package com.clinicos.securestorage

import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class ClinicSecureStorageModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ClinicSecureStorage")

    AsyncFunction("prepareProtectedDirectoryAsync") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("ClinicOS application context is unavailable")
      val directory = File(context.noBackupFilesDir, "secure-capture")
      if (!directory.exists() && !directory.mkdirs()) {
        throw IllegalStateException("Unable to create protected capture directory")
      }
      if (!directory.canonicalPath.startsWith(context.noBackupFilesDir.canonicalPath + File.separator)) {
        throw SecurityException("Capture directory escaped app-private storage")
      }
      mapOf(
        "uri" to Uri.fromFile(directory).toString(),
        "path" to directory.absolutePath,
        "backupExcluded" to true,
        "deviceProtected" to true
      )
    }
  }
}
