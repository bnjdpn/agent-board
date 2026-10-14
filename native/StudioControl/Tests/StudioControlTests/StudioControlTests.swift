import XCTest
@testable import StudioControl

final class StudioControlTests: XCTestCase {
    func testUnknownProcessStateDoesNotBecomeActive() throws {
        let raw = #"{"observed_at":1,"holds":[],"missions":[{"issue":"77","step":"Relecture","wait_reasons":["unknown"],"executors":[{"pid":123,"alive":null,"ownership_verified":false}]}],"registered_jobs_count":null,"unknown_sources":["jobs"]}"#
        let result = try JSONDecoder().decode(Runtime.self, from: Data(raw.utf8))
        XCTAssertNil(result.registered_jobs_count)
        XCTAssertFalse(result.missions[0].running)
        XCTAssertEqual(result.missions[0].issue, 77)
        XCTAssertEqual(result.unknown_sources, ["jobs"])
    }
    @MainActor func testUnavailableControllerCannotDisplayStaleActiveMission() throws {
        let model = StudioModel()
        let raw = #"{"observed_at":1,"holds":[],"missions":[{"issue":77,"executors":[{"pid":123,"alive":true}]}],"unknown_sources":[]}"#
        model.runtime = try JSONDecoder().decode(Runtime.self, from: Data(raw.utf8))
        XCTAssertEqual(model.active.count, 1)
        model.runtimeError = "Source indisponible"
        XCTAssertTrue(model.active.isEmpty)
        XCTAssertEqual(model.stateTitle, "État inconnu")
        XCTAssertFalse(model.canRun)
    }
    func testBoardDecodesFrenchPriorityAndMissingFields() throws {
        let raw = #"{"items":[{"id":"a","title":"Test","priorité":"P1","status":"Prêt","content":{"number":17,"body":"test"}},{"id":"b","title":"Draft"}]}"#
        let result = try JSONDecoder().decode(BoardResponse.self, from: Data(raw.utf8))
        XCTAssertEqual(result.items[0].priority, "P1")
        XCTAssertEqual(result.items[0].number, 17)
        XCTAssertNil(result.items[1].number)
    }
    func testProcessArgumentsAreNotInterpretedByShell() async throws {
        let text = "$(touch /tmp/not-executed) ; hello"
        let result = try await Commands.run("/usr/bin/printf", ["%s", text])
        XCTAssertEqual(result.code, 0)
        XCTAssertEqual(result.text, text)
    }
}
