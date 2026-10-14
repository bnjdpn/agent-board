// swift-tools-version: 5.10
import PackageDescription
let package = Package(
    name: "StudioControl", platforms: [.macOS(.v14)],
    products: [.executable(name: "StudioControl", targets: ["StudioControl"])],
    dependencies: [.package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.0")],
    targets: [
        .executableTarget(name: "StudioControl", dependencies: [.product(name: "Sparkle", package: "Sparkle")],
                          linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]),
        .testTarget(name: "StudioControlTests", dependencies: ["StudioControl"])
    ])
