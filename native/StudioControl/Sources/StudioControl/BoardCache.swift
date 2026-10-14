import Foundation
import Darwin

/// One persisted budget, shared by automatic/manual refreshes and app restarts.
final class BoardCache {
    struct State: Codable {
        var nextRead = Date.distantPast
        var fetchedAt: Date?
        var payload: Data?
        var error: String?
    }
    let url: URL
    private var lock: Int32 = -1
    init(url: URL = Commands.home.appendingPathComponent("Library/Application Support/Studio Control/board-cache.json")) { self.url = url }
    func read() throws -> State {
        guard FileManager.default.fileExists(atPath: url.path) else { return State() }
        return try JSONDecoder().decode(State.self, from: Data(contentsOf: url))
    }
    private func write(_ state: State) throws {
        try JSONEncoder().encode(state).write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    func begin(now: Date = Date()) throws -> Bool {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard lock == -1 else { return false }
        lock = Darwin.open(url.path + ".lock", O_CREAT | O_RDWR, 0o600)
        guard lock >= 0 else { throw CommandFailure(message: "Verrou du cache inaccessible") }
        guard flock(lock, LOCK_EX | LOCK_NB) == 0 else { finish(); return false }
        do {
            var state = try read()
            guard now >= state.nextRead else { finish(); return false }
            // Reserve before requesting: a crash/relaunch cannot reset the budget.
            state.nextRead = now.addingTimeInterval(3600)
            try write(state)
            return true
        } catch { finish(); throw error }
    }
    func success(_ payload: Data, now: Date = Date()) throws {
        defer { finish() }
        try write(State(nextRead: now.addingTimeInterval(900), fetchedAt: now, payload: payload))
    }
    func failure(_ message: String) throws {
        defer { finish() }
        var state = try read(); state.error = message; try write(state)
    }
    func finish() { if lock >= 0 { flock(lock, LOCK_UN); Darwin.close(lock); lock = -1 } }
    deinit { finish() }
}
