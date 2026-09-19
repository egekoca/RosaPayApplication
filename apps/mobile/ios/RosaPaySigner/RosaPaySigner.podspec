Pod::Spec.new do |spec|
  spec.name         = "RosaPaySigner"
  spec.version      = "0.1.0"
  spec.summary      = "Secure Enclave signing and proximity transports for Rosa Pay"
  spec.description  = "Generates and uses a secp256r1 key that never leaves the device, and reads a merchant's request over NFC or Bluetooth LE."
  spec.homepage     = "https://rosapay.local"
  spec.license      = { :type => "UNLICENSED" }
  spec.author       = { "Rosa Pay" => "dev@rosapay.local" }
  spec.platforms    = { :ios => "15.1" }
  spec.source       = { :path => "." }
  spec.source_files = "*.{swift,m,h}"
  # CoreNFC reads a tap; CoreBluetooth is both halves of the BLE transport,
  # which is the only way two iPhones can pay each other by proximity.
  # LocalAuthentication and Security back the signer.
  spec.frameworks   = "CoreNFC", "CoreBluetooth"
  spec.dependency "React-Core"
end
