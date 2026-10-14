import SwiftUI

@MainActor final class StudioModel: ObservableObject {
    @Published var runtime: Runtime?
    @Published var cards: [Card] = []
    @Published var runtimeError: String?
    @Published var boardError: String?
    @Published var actionMessage: String?
    @Published var isRefreshing = false
    @Published var isActing = false
    @Published var selected: Card?
    @Published var logs: [LocalLog] = []
    @Published var selectedLog: String?
    @Published var logText = ""
    @Published var logError: String?
    @Published var wakeup = "Réveil automatique non installé"
    @Published var lastBoardRead: Date?
    private var didStart = false
    private var nextBoardRead = Date.distantPast
    private var polling: Task<Void, Never>?
    private var logPolling: Task<Void, Never>?
    var active: [Mission] { runtimeError == nil ? runtime?.missions.filter(\.running) ?? [] : [] }
    var stateTitle: String {
        if runtimeError != nil || runtime == nil { return "État inconnu" }
        if runtime!.holds.contains(where: { $0.kind == "safety" }) { return "À vérifier" }
        if !runtime!.holds.isEmpty { return "En pause" }
        return active.isEmpty ? "Disponible" : "En activité"
    }
    var stateColor: Color { runtimeError != nil ? .red : runtime?.holds.isEmpty == true ? .mint : .orange }
    var canRun: Bool { runtime != nil && runtimeError == nil && runtime!.holds.isEmpty && runtime!.unknown_sources.isEmpty && !isActing }
    var selectedMission: Mission? { runtime?.missions.first { $0.issue != nil && $0.issue == selected?.number } }
    func start() {
        guard !didStart else { return }; didStart = true
        polling = Task { while !Task.isCancelled { await refresh(forceBoard: false); try? await Task.sleep(for: .seconds(30)) } }
    }
    func refresh(forceBoard: Bool = true) async {
        guard !isRefreshing else { return }; isRefreshing = true; defer { isRefreshing = false }
        async let state: Void = refreshRuntime()
        async let board: Void = refreshBoard(force: forceBoard)
        _ = await (state, board)
        await refreshWakeup()
    }
    func refreshRuntime() async {
        do {
            let result = try await Commands.run(Commands.studio, ["status", "--json"], timeout: 30)
            let value = try JSONDecoder().decode(Runtime.self, from: result.data)
            runtime = value
            runtimeError = result.code == 0 && value.unknown_sources.isEmpty ? nil : "Certaines sources sont indisponibles. Les départs restent bloqués."
        } catch { runtime = nil; runtimeError = "Le contrôleur ne répond pas : \(error.localizedDescription)" }
    }
    func refreshBoard(force: Bool = true) async {
        guard force || Date() >= nextBoardRead else { return }
        nextBoardRead = Date().addingTimeInterval(300)
        do {
            let result = try await Commands.run(Commands.github(), ["project", "item-list", "1", "--owner", "bnjdpn", "--limit", "1000", "--format", "json"], timeout: 90)
            guard result.code == 0 else { throw CommandFailure(message: result.text) }
            cards = try JSONDecoder().decode(BoardResponse.self, from: result.data).items
            lastBoardRead = Date(); boardError = nil
        } catch { nextBoardRead = Date().addingTimeInterval(900); boardError = "GitHub indisponible. \(cards.isEmpty ? "" : "Le dernier board reste affiché.") \(error.localizedDescription)" }
    }
    func refreshWakeup() async {
        let root = Commands.home.appendingPathComponent("Library/Application Support/agent-board/studio-runtime")
        if FileManager.default.fileExists(atPath: root.appendingPathComponent("attention.json").path) {
            wakeup = "Réveil automatique arrêté : diagnostic nécessaire"; return
        }
        guard let data = try? Data(contentsOf: root.appendingPathComponent("heartbeat.json")),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let stamp = value["at"] as? String,
              let date = ISO8601DateFormatter.fractional.date(from: stamp) else { return }
        if Date().timeIntervalSince(date) > 180 { wakeup = "Réveil automatique sans signal récent" }
        else { wakeup = value["state"] as? String == "held" ? "Réveil actif · attend la levée des suspensions" : "Réveil actif · vérification chaque minute" }
    }
    func act(_ command: String, issue: Int? = nil) async {
        guard !isActing else { return }
        var args: [String]
        switch command {
        case "pause": args = ["pause", "--reason", "Pause depuis Studio Control"]
        case "resume": args = ["resume"] + (issue.map { ["--issue", String($0)] } ?? [])
        case "stop": args = ["stop"] + (issue.map { ["--issue", String($0)] } ?? ["--all"])
        case "run": guard canRun else { return }; args = ["run", "--once", "--max-starts", "1"]
        default: return
        }
        isActing = true; actionMessage = nil; defer { isActing = false }
        do {
            let result = try await Commands.run(Commands.studio, args)
            actionMessage = result.code == 0 ? (command == "resume" ? "Reprise autorisée. Aucun ticket démarré par cette commande." : "Commande confirmée.\n\(result.text)") : "Action non confirmée. Aucun nouvel essai automatique.\n\(result.text)"
        } catch { actionMessage = "Action non confirmée : \(error.localizedDescription)" }
        await refreshRuntime()
    }
    func closeSelection() {
        logPolling?.cancel(); logPolling = nil; selected = nil; selectedLog = nil
    }
    func select(_ card: Card) {
        selected = card; selectedLog = nil; logs = []; logText = ""; logError = nil
        logPolling?.cancel()
        logPolling = Task {
            let paths = await discoverLogs(card)
            guard !Task.isCancelled else { return }
            logs = paths; selectedLog = paths.first?.path
            while !Task.isCancelled {
                await readLog()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }
    func discoverLogs(_ card: Card) async -> [LocalLog] {
        guard let number = card.number else { return [] }
        let mission = runtime?.missions.first { $0.issue == number }
        let explicit = (mission?.executors.compactMap(\.run) ?? []) + [mission?.run].compactMap { $0 }
        return await Task.detached(priority: .utility) {
            let fm = FileManager.default; var directories = explicit
            let queue = Commands.home.appendingPathComponent("Documents/Apps/.local/studio-ceo/fill-queue/studio-issue-\(number)")
            if fm.fileExists(atPath: queue.path) { directories.append(queue.path) }
            let archive = Commands.home.appendingPathComponent("Documents/Apps/archives/jobs")
            for date in (try? fm.contentsOfDirectory(atPath: archive.path)) ?? [] where date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil {
                let day = archive.appendingPathComponent(date)
                for job in (try? fm.contentsOfDirectory(atPath: day.path)) ?? [] {
                    let directory = day.appendingPathComponent(job)
                    let status = directory.appendingPathComponent("STATUS")
                    if let data = try? Data(contentsOf: status), let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], String(describing: json["issue"] ?? "") == String(number) { directories.append(directory.path) }
                    else if job.range(of: "(?:^|[-_])\(number)(?:$|[-_])", options: .regularExpression) != nil { directories.append(directory.path) }
                }
            }
            let allowed = ["codex.log", "cursor.log", "launcher.log", "STATUS", "RESULT.txt", "RESULT.json"]
            var paths: [LocalLog] = []
            for directory in Set(directories) {
                let url = URL(fileURLWithPath: directory).standardizedFileURL.resolvingSymlinksInPath()
                let permitted = [archive.path + "/", Commands.home.appendingPathComponent("Documents/Apps/.local/studio-ceo/").path + "/"]
                guard permitted.contains(where: { url.path.hasPrefix($0) }) else { continue }
                for name in allowed {
                    let file = url.appendingPathComponent(name).resolvingSymlinksInPath()
                    guard permitted.contains(where: { file.path.hasPrefix($0) }) else { continue }
                    if fm.fileExists(atPath: file.path) { paths.append(LocalLog(path: file.path)) }
                }
            }
            return paths.sorted { $0.path > $1.path }
        }.value
    }
    func readLog() async {
        guard let path = selectedLog else { return }
        let result: Result<String, Error> = await Task.detached(priority: .utility) {
            Result {
                let file = try FileHandle(forReadingFrom: URL(fileURLWithPath: path)); defer { try? file.close() }
                let size = try file.seekToEnd(); try file.seek(toOffset: size > 128_000 ? size - 128_000 : 0)
                return String(decoding: try file.readToEnd() ?? Data(), as: UTF8.self)
            }
        }.value
        guard path == selectedLog else { return }
        switch result { case .success(let text): logText = text; logError = nil; case .failure(let error): logError = error.localizedDescription }
    }
}
extension ISO8601DateFormatter { static var fractional: ISO8601DateFormatter { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f } }
