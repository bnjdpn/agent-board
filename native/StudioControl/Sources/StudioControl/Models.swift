import Foundation

struct Hold: Decodable { let kind: String; let reason: String }
struct Executor: Decodable {
    let pid: Int; let alive: Bool?; let ownership_verified: Bool?
    let engine: String?; let run: String?
}
struct Mission: Decodable, Identifiable {
    let issue: Int?; let step: String?; let title: String?; let url: String?
    let wait_reasons: [String]; let executors: [Executor]; let run: String?
    var id: String { issue.map(String.init) ?? run ?? title ?? "unknown" }
    var running: Bool { executors.contains { $0.alive == true } }
    enum CodingKeys: String, CodingKey { case issue, step, title, url, wait_reasons, executors, run }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        issue = (try? c.decode(Int.self, forKey: .issue)) ?? (try? c.decode(String.self, forKey: .issue)).flatMap(Int.init)
        step = try c.decodeIfPresent(String.self, forKey: .step); title = try c.decodeIfPresent(String.self, forKey: .title)
        url = try c.decodeIfPresent(String.self, forKey: .url); run = try c.decodeIfPresent(String.self, forKey: .run)
        wait_reasons = try c.decodeIfPresent([String].self, forKey: .wait_reasons) ?? []
        executors = try c.decodeIfPresent([Executor].self, forKey: .executors) ?? []
    }
}
struct Runtime: Decodable {
    let observed_at: Double; let holds: [Hold]; let missions: [Mission]
    let registered_jobs_count: Int?; let unknown_sources: [String]
}
struct BoardResponse: Decodable { let items: [Card] }
struct Card: Decodable, Identifiable, Hashable {
    let id: String; let title: String; let status: String?; let app: String?
    let priority: String?; let content: Content?; let labels: [String]?; let engine: String?
    struct Content: Decodable, Hashable { let number: Int?; let url: String?; let body: String?; let repository: String? }
    enum CodingKeys: String, CodingKey { case id, title, status, app, content, labels; case priority = "priorité"; case engine = "moteur" }
    var number: Int? { content?.number }
}
struct LocalLog: Identifiable, Hashable { let path: String; var id: String { path }; var name: String { URL(fileURLWithPath: path).lastPathComponent } }
struct CommandResult { let code: Int32; let data: Data; var text: String { String(decoding: data, as: UTF8.self) } }
struct CommandFailure: LocalizedError { let message: String; var errorDescription: String? { message } }

enum Commands {
    static let home = FileManager.default.homeDirectoryForCurrentUser
    static let studio = home.appendingPathComponent(".local/bin/studio").path
    static func run(_ executable: String, _ arguments: [String], timeout: Double = 120) async throws -> CommandResult {
        try await Task.detached(priority: .utility) {
            let process = Process(); let pipe = Pipe()
            process.executableURL = URL(fileURLWithPath: executable); process.arguments = arguments
            process.standardOutput = pipe; process.standardError = pipe
            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] = [home.appendingPathComponent(".local/bin").path, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", environment["PATH"] ?? ""].joined(separator: ":")
            process.environment = environment
            try process.run()
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { if process.isRunning { process.terminate() } }
            let data = pipe.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
            return CommandResult(code: process.terminationStatus, data: data)
        }.value
    }
    static func github() throws -> String {
        for path in ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", home.appendingPathComponent(".local/bin/gh").path] {
            if FileManager.default.isExecutableFile(atPath: path) { return path }
        }
        throw CommandFailure(message: "GitHub CLI est introuvable sur ce Mac.")
    }
}
