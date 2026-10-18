import Cocoa
import WebKit
import UniformTypeIdentifiers

// Offline Mac host for the exact same HTML/CSS/JS app used by the browser edition.
// There is no backend, login, embedded server or third-party runtime.
final class DoubleTroubleApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let appFolderName = "Double Trouble Darts"
    private let maxDatabaseBytes = 40 * 1024 * 1024

    private var dataFolder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(appFolderName, isDirectory: true)
    }
    private var databaseURL: URL { dataFolder.appendingPathComponent("club.json") }
    private var backupsFolder: URL { dataFolder.appendingPathComponent("Automatic Backups", isDirectory: true) }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        createMenus()
        do { try FileManager.default.createDirectory(at: dataFolder, withIntermediateDirectories: true) }
        catch { showError("Could not create the club data folder: \(error.localizedDescription)") }

        let controller = WKUserContentController()
        controller.add(self, name: "dartsSave")
        controller.add(self, name: "dartsExport")
        controller.add(self, name: "dartsError")

        let saved = (try? Data(contentsOf: databaseURL)) ?? Data()
        let savedBase64 = saved.base64EncodedString()
        let bootstrap = """
        (() => {
          const raw = '\(savedBase64)';
          window.__DOUBLE_TROUBLE_SAVED_JSON__ = raw
            ? new TextDecoder().decode(Uint8Array.from(atob(raw), c => c.charCodeAt(0)))
            : null;
          window.__DOUBLE_TROUBLE_NATIVE_VERSION__ = '4.1.0';
        })();
        """
        controller.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let config = WKWebViewConfiguration()
        config.userContentController = controller
        config.websiteDataStore = WKWebsiteDataStore.default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.mediaTypesRequiringUserActionForPlayback = [] // Allow hands-free entrance themes after turns

        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Double Trouble • Darts Club"
        window.minSize = NSSize(width: 880, height: 620)
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.titleVisibility = .visible
        window.contentView = webView
        window.center()

        guard let webFolder = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true) else {
            showError("The web interface is missing from the application bundle.")
            return
        }
        webView.loadFileURL(webFolder.appendingPathComponent("index.html"), allowingReadAccessTo: webFolder)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func createMenus() {
        let menuBar = NSMenu()
        let appRoot = NSMenuItem()
        menuBar.addItem(appRoot)
        let appMenu = NSMenu()
        appRoot.submenu = appMenu
        let about = appMenu.addItem(withTitle: "About Double Trouble", action: #selector(aboutApp), keyEquivalent: "")
        about.target = self
        appMenu.addItem(.separator())
        let quit = appMenu.addItem(withTitle: "Quit Double Trouble", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApp

        let fileRoot = NSMenuItem(title: "File", action: nil, keyEquivalent: "")
        let fileMenu = NSMenu(title: "File")
        fileRoot.submenu = fileMenu
        let save = fileMenu.addItem(withTitle: "Back Up Club Data…", action: #selector(exportBackup), keyEquivalent: "s")
        save.target = self
        let restore = fileMenu.addItem(withTitle: "Restore Club Backup…", action: #selector(restoreBackup), keyEquivalent: "o")
        restore.target = self
        fileMenu.addItem(.separator())
        let reveal = fileMenu.addItem(withTitle: "Show Saved Data in Finder", action: #selector(showDataFolder), keyEquivalent: "")
        reveal.target = self
        menuBar.addItem(fileRoot)

        let viewRoot = NSMenuItem(title: "View", action: nil, keyEquivalent: "")
        let viewMenu = NSMenu(title: "View")
        viewRoot.submenu = viewMenu
        let players = viewMenu.addItem(withTitle: "Players / Hall of Fame", action: #selector(openClub), keyEquivalent: "1")
        players.target = self
        let league = viewMenu.addItem(withTitle: "League", action: #selector(openLeague), keyEquivalent: "2")
        league.target = self
        let fullscreen = viewMenu.addItem(withTitle: "Toggle Full Screen", action: #selector(toggleFullScreen), keyEquivalent: "f")
        fullscreen.keyEquivalentModifierMask = [.command, .control]
        fullscreen.target = self
        menuBar.addItem(viewRoot)
        NSApp.mainMenu = menuBar
    }

    @objc private func aboutApp() {
        let alert = NSAlert()
        alert.messageText = "DOUBLE TROUBLE 4.1"
        alert.informativeText = "Precision Club Machine. Real 3D darts, completely offline.\n\nMatch data saves automatically into your Mac's Application Support folder. Updates replace the app, not your club records."
        alert.alertStyle = .informational
        alert.runModal()
    }
    @objc private func exportBackup() {
        webView?.evaluateJavaScript("window.DoubleTrouble?.exportBackup()", completionHandler: nil)
    }
    @objc private func restoreBackup() {
        let panel = NSOpenPanel()
        panel.message = "Select a Double Trouble V2, V3 or V4 JSON club backup"
        panel.allowedContentTypes = [.json]
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { [weak self] answer in
            guard answer == .OK, let url = panel.url, let self = self else { return }
            do {
                let data = try Data(contentsOf: url)
                guard data.count < 40 * 1024 * 1024 else { throw NSError(domain: "Darts", code: 1, userInfo: [NSLocalizedDescriptionKey: "Backup exceeds 40 MB."]) }
                let bytes = data.base64EncodedString()
                let js = "void window.DoubleTrouble.importBackupJSON(new TextDecoder().decode(Uint8Array.from(atob('\(bytes)'), c => c.charCodeAt(0)))).catch(e => window.webkit.messageHandlers.dartsError.postMessage(String(e.message || e)))"
                self.webView.evaluateJavaScript(js) { _, error in
                    if let error = error { self.showError("Could not restore: \(error.localizedDescription)") }
                }
            } catch { self.showError("Could not read backup: \(error.localizedDescription)") }
        }
    }
    @objc private func openClub() {
        webView?.evaluateJavaScript("window.DoubleTrouble?.openClub()", completionHandler: nil)
    }
    @objc private func openLeague() {
        webView?.evaluateJavaScript("document.querySelector('[data-action=league]')?.click()", completionHandler: nil)
    }
    @objc private func showDataFolder() {
        NSWorkspace.shared.open(dataFolder)
    }
    @objc private func toggleFullScreen() {
        window?.toggleFullScreen(nil)
    }

    // Every score, roster change and match result is atomically persisted.
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "dartsSave":
            guard let json = message.body as? String else { return }
            persistClub(json)
        case "dartsExport":
            guard let request = message.body as? [String: Any],
                  let name = request["filename"] as? String,
                  let content = request["content"] as? String else { return }
            exportJSON(content, suggestedName: name)
        case "dartsError":
            if let details = message.body as? String { showError(details) }
        default: break
        }
    }
    private func persistClub(_ json: String) {
        guard let data = json.data(using: .utf8), data.count < maxDatabaseBytes else {
            reportSaveError("Club data exceeds the 40 MB limit.")
            return
        }
        // Verify the full JSON before touching the current save file.
        guard (try? JSONSerialization.jsonObject(with: data)) != nil else {
            reportSaveError("Invalid JSON: the existing club data was preserved.")
            return
        }
        do {
            try FileManager.default.createDirectory(at: dataFolder, withIntermediateDirectories: true)
            do { try keepDailyBackupBeforeWriting() }
            catch { NSLog("Could not create automatic backup: %@", error.localizedDescription) }
            try data.write(to: databaseURL, options: .atomic)
        } catch { reportSaveError(error.localizedDescription) }
    }
    private func keepDailyBackupBeforeWriting() throws {
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: databaseURL.path) else { return }
        try fileManager.createDirectory(at: backupsFolder, withIntermediateDirectories: true)
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        let backup = backupsFolder.appendingPathComponent("club-\(formatter.string(from: Date())).json")
        if !fileManager.fileExists(atPath: backup.path) {
            try fileManager.copyItem(at: databaseURL, to: backup)
            let backups = (try? fileManager.contentsOfDirectory(at: backupsFolder, includingPropertiesForKeys: nil))?
                .filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent } ?? []
            for obsolete in backups.dropLast(30) { try? fileManager.removeItem(at: obsolete) }
        }
    }
    private func exportJSON(_ content: String, suggestedName: String) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.json]
        panel.nameFieldStringValue = URL(fileURLWithPath: suggestedName).lastPathComponent
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { [weak self] answer in
            guard answer == .OK, let url = panel.url else { return }
            do { try content.write(to: url, atomically: true, encoding: .utf8) }
            catch { self?.showError("Export failed: \(error.localizedDescription)") }
        }
    }
    private func reportSaveError(_ details: String) {
        NSLog("Double Trouble save failed: %@", details)
        showError("Automatic saving failed. Previous data is untouched.\n\n\(details)")
    }
    private func showError(_ text: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Double Trouble"
        alert.informativeText = text
        if window != nil { alert.beginSheetModal(for: window, completionHandler: nil) }
        else { alert.runModal() }
    }

    // These delegates give the local UI actual macOS file pickers and JS confirmations.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { answer in
            completionHandler(answer == .OK ? panel.urls : nil)
        }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Double Trouble"
        alert.informativeText = message
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Cancel")
        alert.alertStyle = .warning
        alert.beginSheetModal(for: window) { result in completionHandler(result == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Double Trouble"
        alert.informativeText = prompt
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 290, height: 26))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil)
        }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "Double Trouble"
        alert.informativeText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.isFileURL || url.scheme == "about" { decisionHandler(.allow); return }
        if let scheme = url.scheme, scheme == "https" || scheme == "http" {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }
}

let app = NSApplication.shared
let delegate = DoubleTroubleApp()
app.delegate = delegate
app.run()
