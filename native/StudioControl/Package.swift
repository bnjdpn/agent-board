// swift-tools-version: 5.10
import PackageDescription
let package = Package(name: "StudioControl", platforms: [.macOS(.v14)], products: [.executable(name: "StudioControl", targets: ["StudioControl"])], targets: [.executableTarget(name: "StudioControl"), .testTarget(name: "StudioControlTests", dependencies: ["StudioControl"])])
