Pod::Spec.new do |s|
  s.name           = 'ClinicSecureStorage'
  s.version        = '1.0.0'
  s.summary        = 'ClinicOS protected app-private capture directory.'
  s.description    = 'Creates and verifies the backup-excluded, complete-protection directory used by ClinicOS native capture.'
  s.license        = { :type => 'UNLICENSED' }
  s.author         = 'ClinicOS'
  s.homepage       = 'https://github.com/AbhinavGupta707/ClinicOS'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = {
    :git => 'https://github.com/AbhinavGupta707/ClinicOS.git',
    :branch => 'main'
  }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
