import SwiftUI
import AppKit

final class StudioAppDelegate: NSObject, NSApplicationDelegate {
    var reopen: (() -> Void)?
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { reopen?() }
        return true
    }
}

struct StudioScene: View {
    @Environment(\.openWindow) private var openWindow
    let delegate: StudioAppDelegate
    var body: some View {
        StudioWindow().onAppear { delegate.reopen = { openWindow(id: "studio") } }
    }
}

@main struct StudioControlApp: App {
    @NSApplicationDelegateAdaptor(StudioAppDelegate.self) private var delegate
    @StateObject private var model = StudioModel()
    @StateObject private var updates = StudioUpdates()
    init() {
        let args = CommandLine.arguments
        if let index = args.firstIndex(of: "--snapshot"), args.count > index + 3 {
            let previewModel = StudioModel()
            previewModel.runtime = try? JSONDecoder().decode(Runtime.self, from: Data(contentsOf: URL(fileURLWithPath: args[index + 2])))
            previewModel.cards = (try? JSONDecoder().decode(BoardResponse.self, from: Data(contentsOf: URL(fileURLWithPath: args[index + 3]))).items) ?? []
            previewModel.lastBoardRead = Date()
            let view = NSHostingView(rootView: StudioWindow().environmentObject(previewModel))
            view.frame = NSRect(x: 0, y: 0, width: 1320, height: 860)
            let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            window.contentView = view
            RunLoop.main.run(until: Date().addingTimeInterval(1))
            view.layoutSubtreeIfNeeded()
            view.displayIfNeeded()
            if let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                view.cacheDisplay(in: view.bounds, to: bitmap)
                try? bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: args[index + 1]))
            }
            exit(0)
        }
    }
    var body: some Scene {
        Window("Studio Control", id: "studio") {
            StudioScene(delegate: delegate).environmentObject(model).task { model.start(); updates.start() }
        }.defaultSize(width: 1320, height: 860)
        .commands { CommandGroup(after: .appInfo) { StudioUpdateButton(updates: updates) } }
        MenuBarExtra {
            StudioMenu(updates: updates).environmentObject(model).task { model.start(); updates.start() }
        } label: {
            Image(systemName: "square.stack.3d.up.fill")
                .accessibilityLabel("Studio Control — \(model.stateTitle)")
        }.menuBarExtraStyle(.window)
    }
}

struct StudioMenu: View {
    @ObservedObject var updates: StudioUpdates
    @EnvironmentObject var model: StudioModel
    @Environment(\.openWindow) var openWindow
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                StudioMark(size: 36)
                VStack(alignment: .leading, spacing: 3) { Text("Studio Control").font(.headline); Text(model.stateTitle).font(.caption).foregroundStyle(model.stateColor) }
                Spacer()
                if model.isRefreshing { ProgressView().controlSize(.small) }
            }
            HStack { Text("Missions actives").foregroundStyle(.secondary); Spacer(); Text(model.runtimeError == nil && model.runtime != nil ? "\(model.active.count)" : "—").monospacedDigit().bold() }
            Text(model.wakeup).font(.caption).foregroundStyle(.secondary)
            if let error = model.runtimeError { Text(error).font(.caption).foregroundStyle(.red).lineLimit(3) }
            Divider()
            Button { openWindow(id: "studio"); NSApp.activate(ignoringOtherApps: true) } label: { Label("Ouvrir le studio", systemImage: "macwindow") }.buttonStyle(.borderedProminent).tint(.teal).frame(maxWidth: .infinity)
            HStack {
                Button("Pause") { Task { await model.act("pause") } }
                Button("Reprendre") { Task { await model.act("resume") } }
                Spacer()
                Button { Task { await model.refresh() } } label: { Image(systemName: "arrow.clockwise") }.help("Actualiser")
            }.disabled(model.isActing)
            if model.isActing { ProgressView("Application de la commande…").controlSize(.small) }
            if let message = model.actionMessage { Text(message).font(.caption).lineLimit(5).textSelection(.enabled) }
            Divider()
            StudioUpdateButton(updates: updates)
            Text("Version \(updates.version)").font(.caption2).foregroundStyle(.secondary)
            Button("Quitter l’interface") { NSApp.terminate(nil) }.font(.caption).foregroundStyle(.secondary)
            Text("Fermer l’interface ne met pas les missions en pause.").font(.caption2).foregroundStyle(.tertiary)
        }.padding(22).frame(width: 330)
    }
}

struct StudioMark: View {
    var size: CGFloat = 44
    var body: some View {
        Image(systemName: "square.stack.3d.up.fill").font(.system(size: size * 0.46, weight: .semibold))
            .foregroundStyle(.white).frame(width: size, height: size)
            .background(LinearGradient(colors: [Color(red: 0.08, green: 0.50, blue: 0.47), Color(red: 0.05, green: 0.24, blue: 0.31)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: size * 0.26))
    }
}

struct StudioWindow: View {
    @EnvironmentObject var model: StudioModel
    @State private var lane: String? = "Vue d’ensemble"
    @State private var search = ""
    private let lanes = ["Prêt", "En cours", "Relecture", "À livrer", "En validation store", "À cadrer", "Idées", "Terminé"]
    private let flow = ["Prêt", "En cours", "Relecture", "À livrer", "En validation store", "Terminé"]
    var visible: [Card] {
        model.cards.filter { card in
            let selected = lane ?? "Vue d’ensemble"
            let inLane = selected == "Vue d’ensemble" ? flow.contains(card.status ?? "") : card.status == selected
            return inLane && (search.isEmpty || card.title.localizedCaseInsensitiveContains(search) || card.app?.localizedCaseInsensitiveContains(search) == true || String(card.number ?? 0).contains(search))
        }
    }
    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) { StudioMark(); VStack(alignment: .leading) { Text("STUDIO").font(.system(size: 11, weight: .bold)).tracking(2).foregroundStyle(.secondary); Text("Control").font(.title2.weight(.semibold)) } }.padding(.horizontal, 18).padding(.top, 24)
                List(selection: $lane) {
                    Label("Vue d’ensemble", systemImage: "square.grid.2x2").tag("Vue d’ensemble")
                    Section("Flux de travail") {
                        ForEach(lanes, id: \.self) { name in
                            HStack { Label(name, systemImage: symbol(name)); Spacer(); Text(model.lastBoardRead == nil ? "—" : "\(model.cards.filter { $0.status == name }.count)").font(.caption.monospacedDigit()).foregroundStyle(.secondary) }.tag(name)
                        }
                    }
                }.listStyle(.sidebar)
                VStack(alignment: .leading, spacing: 8) {
                    Label("Grok pilote · les agents exécutent", systemImage: "point.3.connected.trianglepath.dotted").font(.caption)
                    Text("Livraisons décidées par Studio CEO").font(.caption2).foregroundStyle(.secondary)
                }.padding(18)
            }.navigationSplitViewColumnWidth(min: 210, ideal: 230, max: 280)
        } detail: {
            HSplitView {
                VStack(alignment: .leading, spacing: 0) {
                    overview.padding(26)
                    HStack {
                        Text(lane ?? "Vue d’ensemble").font(.title2.weight(.semibold))
                        Text(model.lastBoardRead == nil ? "—" : "\(visible.count)").font(.callout.monospacedDigit()).foregroundStyle(.secondary)
                        Spacer()
                        if model.isRefreshing { ProgressView().controlSize(.small) }
                    }.padding(.horizontal, 26).padding(.bottom, 16)
                    if lane == "Vue d’ensemble" || lane == nil {
                        kanban
                    } else {
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 245), spacing: 14)], spacing: 14) {
                            ForEach(visible) { card in MissionCard(card: card, selected: model.selected?.id == card.id, running: model.active.contains { $0.issue == card.number }) { model.select(card) } }
                        }.padding(.horizontal, 26).padding(.bottom, 24)
                        if visible.isEmpty { ContentUnavailableView(search.isEmpty ? "Aucune mission dans cette vue" : "Aucun résultat", systemImage: "tray", description: Text(model.boardError == nil ? "Le backlog se remplit depuis les décisions de Studio CEO." : "Le board n’a pas pu être actualisé.")) }
                    }
                    }
                    HStack { Circle().fill(model.boardError == nil ? Color.teal : .orange).frame(width: 5, height: 5); Text(model.lastBoardRead.map { "GitHub · actualisé à \($0.formatted(date: .omitted, time: .shortened))" } ?? (model.boardError == nil ? "Connexion à GitHub…" : "GitHub indisponible")); Spacer(); Text(model.wakeup).lineLimit(1) }.font(.caption2).foregroundStyle(.secondary).padding(14).background(.bar)
                }.frame(minWidth: 480)
                if let card = model.selected { MissionDetail(card: card).frame(minWidth: 360, idealWidth: 440, maxWidth: 600) }
            }.background(Color(nsColor: .windowBackgroundColor))
            .searchable(text: $search, prompt: "Rechercher une app ou une mission")
            .toolbar {
                ToolbarItemGroup {
                    Button { Task { await model.refresh() } } label: { Label("Actualiser", systemImage: "arrow.clockwise") }.disabled(model.isRefreshing)
                    Button { Task { await model.act("pause") } } label: { Label("Pause", systemImage: "pause.fill") }.help("Empêcher les nouveaux départs ; les missions actives continuent")
                    Button { Task { await model.act("resume") } } label: { Label("Reprendre", systemImage: "play.fill") }.help("Réconcilier les missions et retirer la pause opérateur")
                    Menu { Button("Arrêter toutes les missions", role: .destructive) { Task { await model.act("stop") } }; Button("Exécuter le prochain ticket") { Task { await model.act("run") } }.disabled(!model.canRun) } label: { Image(systemName: "ellipsis.circle") }
                }
            }.disabled(model.isActing)
        }.tint(.teal)
    }
    var kanban: some View {
        GeometryReader { geometry in
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(flow, id: \.self) { column in
                        let cards = visible.filter { $0.status == column }
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 8) {
                                Image(systemName: symbol(column)).foregroundStyle(column == "En cours" ? Color.teal : .secondary)
                                Text(column).font(.callout.weight(.semibold))
                                Spacer()
                                Text(model.lastBoardRead == nil ? "—" : String(cards.count)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            }.padding(.horizontal, 12).padding(.top, 14)
                            ScrollView {
                                LazyVStack(spacing: 10) {
                                    ForEach(cards) { card in
                                        MissionCard(card: card, selected: model.selected?.id == card.id, running: model.active.contains { $0.issue == card.number }) { model.select(card) }
                                    }
                                    if cards.isEmpty {
                                        Text(model.lastBoardRead == nil ? (model.boardError == nil ? "Chargement…" : "Données indisponibles") : "Aucune mission").font(.caption).foregroundStyle(.tertiary).frame(maxWidth: .infinity).padding(.vertical, 30)
                                    }
                                }.padding(.horizontal, 8).padding(.bottom, 12)
                            }
                        }.frame(width: 280).background(.primary.opacity(0.025), in: RoundedRectangle(cornerRadius: 16))
                    }
                }.frame(height: max(180, geometry.size.height - 14)).padding(.horizontal, 26)
            }
        }
    }
    var overview: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 7) { Text("Studio").font(.system(size: 28, weight: .semibold, design: .rounded)); Text("Missions, exécution et livraisons").font(.subheadline).foregroundStyle(.secondary) }
                Spacer()
                HStack(spacing: 6) { Circle().fill(model.stateColor).frame(width: 7, height: 7); Text(model.stateTitle).font(.caption.weight(.semibold)) }.padding(.horizontal, 12).padding(.vertical, 8).background(model.stateColor.opacity(0.10), in: Capsule())
            }
            HStack(spacing: 12) {
                Metric(title: "Actives sur ce Mac", value: model.runtimeError == nil && model.runtime != nil ? String(model.active.count) : "—", icon: "bolt.fill", color: .teal)
                Metric(title: "Prêtes", value: model.lastBoardRead == nil ? "—" : String(model.cards.filter { $0.status == "Prêt" }.count), icon: "tray.full", color: .blue)
                Metric(title: "À livrer", value: model.lastBoardRead == nil ? "—" : String(model.cards.filter { $0.status == "À livrer" }.count), icon: "shippingbox", color: .purple)
            }
            if let next = model.nextBoardRead, next > Date() { Text("Prochaine lecture GitHub à \(next.formatted(date: .omitted, time: .shortened))").font(.caption2).foregroundStyle(.secondary) }
            if let error = model.runtimeError ?? model.boardError { Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange).textSelection(.enabled) }
            if let runtime = model.runtime, !runtime.holds.isEmpty {
                DisclosureGroup {
                    ForEach(Array(runtime.holds.enumerated()), id: \.offset) { _, hold in Text(hold.reason).font(.caption).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 5) }
                    Text("Reprendre conserve les suspensions de sécurité. Pause laisse les missions actives se terminer ; Arrêter les interrompt.").font(.caption).foregroundStyle(.secondary).padding(.top, 8)
                } label: { Label("Les nouveaux départs sont suspendus", systemImage: "pause.circle.fill").font(.callout.weight(.medium)).foregroundStyle(.orange) }.padding(14).background(.orange.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
            }
            if model.isActing { ProgressView("Application de la commande…").controlSize(.small) }
            if let message = model.actionMessage { DisclosureGroup("Résultat de la commande") { Text(message).font(.caption.monospaced()).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) } }
        }
    }
    func symbol(_ lane: String) -> String { switch lane { case "Prêt": return "tray.full"; case "En cours": return "bolt"; case "Relecture": return "checkmark.bubble"; case "À livrer": return "shippingbox"; case "En validation store": return "hourglass"; case "À cadrer": return "pencil.and.outline"; case "Idées": return "lightbulb"; default: return "checkmark.circle" } }
}

struct Metric: View {
    let title: String; let value: String; let icon: String; let color: Color
    var body: some View { VStack(alignment: .leading, spacing: 14) { HStack { Image(systemName: icon).foregroundStyle(color); Spacer(); Text(value).font(.system(size: 26, weight: .semibold, design: .rounded)).monospacedDigit() }; Text(title).font(.caption).foregroundStyle(.secondary) }.padding(17).frame(maxWidth: .infinity, alignment: .leading).background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.primary.opacity(0.04))) }
}
struct MissionCard: View {
    let card: Card; let selected: Bool; let running: Bool; let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                HStack { Text(card.app ?? "Studio").font(.caption.weight(.semibold)).foregroundStyle(.teal); Spacer(); Text(card.priority ?? "").font(.caption2.weight(.bold)).foregroundStyle(.secondary) }
                if card.labels?.contains(where: { ["bloqué", "blocked", "needs-ceo"].contains($0.lowercased()) }) == true {
                    Label("Bloquée", systemImage: "exclamationmark.circle").font(.caption2).foregroundStyle(.orange)
                }
                Text(card.title).font(.system(size: 14, weight: .medium)).lineLimit(3).frame(maxWidth: .infinity, alignment: .leading).frame(minHeight: 52, alignment: .top)
                HStack { Text(card.number.map { "#\($0)" } ?? "Brouillon").monospacedDigit(); Spacer(); if running { Circle().fill(.teal).frame(width: 5, height: 5); Text(card.engine.map { "\($0.capitalized) actif" } ?? "Agent actif").foregroundStyle(.teal) } else { Text(card.status ?? "Non classé") } }.font(.caption2).foregroundStyle(.secondary)
            }.padding(18).background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(selected ? Color.teal : .primary.opacity(0.07), lineWidth: selected ? 2 : 1))
        }.buttonStyle(.plain)
    }
}

struct MissionDetail: View {
    @EnvironmentObject var model: StudioModel
    let card: Card
    @State private var tab = "Mission"
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Text(card.number.map { "MISSION #\($0)" } ?? "MISSION").font(.caption.weight(.bold)).tracking(1.4).foregroundStyle(.secondary); Spacer(); if let raw = card.content?.url, let url = URL(string: raw), url.host == "github.com" { Link(destination: url) { Image(systemName: "arrow.up.right.square") } }; Button { model.closeSelection() } label: { Image(systemName: "xmark") }.buttonStyle(.plain) }
            Text(card.title).font(.title2.weight(.semibold))
            HStack { Label(card.status ?? "Non classé", systemImage: "circle.dashed"); Spacer(); Text(card.app ?? "Studio") }.font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("Arrêter la mission", systemImage: "stop.fill") { if let n = card.number { Task { await model.act("stop", issue: n) } } }
                Button("Autoriser sa reprise", systemImage: "play") { if let n = card.number { Task { await model.act("resume", issue: n) } } }
            }.controlSize(.small).disabled(card.number == nil || model.isActing)
            Picker("Détail", selection: $tab) { Text("Mission").tag("Mission"); Text("Journal en direct").tag("Journal") }.pickerStyle(.segmented)
            if tab == "Mission" {
                ScrollView {
                    VStack(alignment: .leading, spacing: 15) {
                        if let mission = model.selectedMission {
                            ForEach(Array(mission.wait_reasons.filter { !$0.hasPrefix("operator:") && !$0.hasPrefix("safety:") }.enumerated()), id: \.offset) { _, reason in Label(reason, systemImage: "info.circle").font(.caption).foregroundStyle(.secondary) }
                        }
                        Text(card.content?.body ?? "Pas de description disponible.").font(.system(size: 13)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            } else {
                if model.logs.isEmpty { ContentUnavailableView("Aucun journal associé", systemImage: "text.alignleft", description: Text("Les journaux apparaissent lorsque l’exécution est identifiée. Une carte « En cours » n’est pas une preuve qu’un agent tourne.")) }
                else {
                    Picker("Journal", selection: $model.selectedLog) { ForEach(model.logs) { log in Text("\(URL(fileURLWithPath: log.path).deletingLastPathComponent().lastPathComponent) / \(log.name)").tag(Optional(log.path)) } }.labelsHidden()
                    HStack { Circle().fill(.teal).frame(width: 6, height: 6); Text("Lecture chaque seconde · dernières 128 Ko").font(.caption2).foregroundStyle(.secondary) }
                    ScrollView([.vertical, .horizontal]) { Text(model.logError ?? (model.logText.isEmpty ? "En attente de sortie…" : model.logText)).font(.system(size: 11, design: .monospaced)).textSelection(.enabled).padding(14).frame(maxWidth: .infinity, alignment: .leading) }.background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }.padding(24).background(.background)
    }
}
