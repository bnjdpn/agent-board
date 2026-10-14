import SwiftUI
import Sparkle

@MainActor final class StudioUpdates: ObservableObject {
    @Published var canCheck = false
    private var controller: SPUStandardUpdaterController?
    var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Développement" }
    func start() {
        guard controller == nil, Bundle.main.bundleURL.pathExtension == "app" else { return }
        let updater = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: nil, userDriverDelegate: nil)
        controller = updater
        updater.updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheck)
        updater.startUpdater()
    }
    func check() { controller?.checkForUpdates(nil) }
}

struct StudioUpdateButton: View {
    @ObservedObject var updates: StudioUpdates
    var body: some View {
        Button("Rechercher des mises à jour…") { updates.check() }.disabled(!updates.canCheck)
    }
}
