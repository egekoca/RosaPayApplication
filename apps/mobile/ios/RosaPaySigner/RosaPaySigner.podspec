Pod::Spec.new do |spec|
  spec.name         = "RosaPaySigner"
  spec.version      = "0.1.0"
  spec.summary      = "Secure Enclave signing for Lumenade Pay"
  spec.description  = "Generates and uses a secp256r1 key that never leaves the device."
  spec.homepage     = "https://rosapay.local"
  spec.license      = { :type => "UNLICENSED" }
  spec.author       = { "Lumenade Pay" => "dev@rosapay.local" }
  spec.platforms    = { :ios => "15.1" }
  spec.source       = { :path => "." }
  spec.source_files = "*.{swift,m,h}"
  spec.dependency "React-Core"
end
