import ExpoModulesCore
import Foundation

public final class ClinicSecureStorageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ClinicSecureStorage")

    AsyncFunction("prepareProtectedDirectoryAsync") { () -> [String: Any] in
      let fileManager = FileManager.default
      let applicationSupport = try fileManager.url(
        for: .applicationSupportDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      )
      var directory = applicationSupport.appendingPathComponent(
        "ClinicOSSecureCapture",
        isDirectory: true
      )
      try fileManager.createDirectory(
        at: directory,
        withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.complete]
      )
      var resourceValues = URLResourceValues()
      resourceValues.isExcludedFromBackup = true
      try directory.setResourceValues(resourceValues)
      try fileManager.setAttributes(
        [.protectionKey: FileProtectionType.complete],
        ofItemAtPath: directory.path
      )
      let verifiedValues = try directory.resourceValues(forKeys: [.isExcludedFromBackupKey])
      let verifiedAttributes = try fileManager.attributesOfItem(atPath: directory.path)
      let verifiedProtection = verifiedAttributes[.protectionKey] as? FileProtectionType

      return [
        "uri": directory.absoluteString,
        "path": directory.path,
        "backupExcluded": verifiedValues.isExcludedFromBackup == true,
        "deviceProtected": verifiedProtection == .complete
      ]
    }
  }
}
