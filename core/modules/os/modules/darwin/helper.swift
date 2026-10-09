// Menu-bar item and global hotkey for Projector. Commands arrive on stdin, events leave on stdout.
import AppKit
import Carbon

setbuf(stdout, nil)
func emit(_ line: String) { print(line); fflush(stdout) }

let hotkeys: [String: (modifiers: UInt32, code: UInt32)] = [
  "Ctrl+Alt+Space": (UInt32(controlKey | optionKey), 49),
  "Alt+Space": (UInt32(optionKey), 49),
]
var hotKeyRef: EventHotKeyRef? = nil
var handlerInstalled = false

func registerHotkey(_ name: String) -> String {
  if let ref = hotKeyRef { UnregisterEventHotKey(ref); hotKeyRef = nil }
  guard let spec = hotkeys[name] else { return "hotkey:none" }
  if !handlerInstalled {
    var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in emit("event:hotkey"); return noErr }, 1, &type, nil, nil)
    handlerInstalled = true
  }
  let id = EventHotKeyID(signature: OSType(0x504A4B59), id: 1)
  let status = RegisterEventHotKey(spec.code, spec.modifiers, id, GetApplicationEventTarget(), 0, &hotKeyRef)
  return status == noErr ? "hotkey:ok" : "hotkey:busy"
}

let arguments = CommandLine.arguments
if arguments.count > 2 && arguments[1] == "--probe" {
  emit(registerHotkey(arguments[2]))
  exit(0)
}

if arguments.count > 3 && arguments[1] == "--app" {
  guard let pid = Int32(arguments[2]), let running = NSRunningApplication(processIdentifier: pid) else {
    emit("gone")
    exit(1)
  }
  switch arguments[3] {
  case "activate":
    running.unhide()
    running.activate(options: [.activateIgnoringOtherApps])
  case "hide": running.hide()
  case "terminate": running.terminate()
  default: break
  }
  RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
  emit(running.isHidden ? "hidden" : running.isActive ? "active" : "visible")
  exit(0)
}

if arguments.count > 2 && arguments[1] == "--windows" {
  // On-screen, normal-layer windows of a process: proves a palette is really shown.
  let owner = Int(arguments[2]) ?? -1
  let list = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
  let count = list.filter { info in
    guard (info[kCGWindowOwnerPID as String] as? Int) == owner, (info[kCGWindowLayer as String] as? Int) == 0,
          let bounds = info[kCGWindowBounds as String] as? [String: Any] else { return false }
    return ((bounds["Width"] as? Double) ?? 0) > 100 && ((bounds["Height"] as? Double) ?? 0) > 100
  }.count
  emit("windows:\(count)")
  exit(0)
}

final class Target: NSObject, NSMenuDelegate {
  func menuWillOpen(_ menu: NSMenu) { emit("menu:open") }
  func menu(_ menu: NSMenu, willHighlight item: NSMenuItem?) { emit("highlight:\(item?.title ?? "")") }
  func menuDidClose(_ menu: NSMenu) { emit("menu:close") }
  @objc func activate() { emit("event:activate") }
  @objc func settings() { emit("event:settings") }
  @objc func restart() { emit("event:restart") }
  @objc func quit() { emit("event:quit") }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let target = Target()
let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
if arguments.count > 1, let image = NSImage(contentsOfFile: arguments[1]) {
  image.size = NSSize(width: 18, height: 18)
  item.button?.image = image
} else {
  item.button?.title = "P"
}
let menu = NSMenu()
for (title, action) in [("Открыть", #selector(Target.activate)), ("Настройки", #selector(Target.settings)),
                        ("Перезапустить", #selector(Target.restart)), ("Выйти", #selector(Target.quit))] {
  let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
  entry.target = target
  menu.addItem(entry)
}
menu.delegate = target
item.menu = menu

DispatchQueue.global().async {
  while let line = readLine() {
    DispatchQueue.main.async {
      if line.hasPrefix("hotkey ") { emit(registerHotkey(String(line.dropFirst(7)))) }
      else if line == "quit" { NSApp.terminate(nil) }
      else if ProcessInfo.processInfo.environment["PROJECTOR_SHELL_TEST"] == "1" {
        // Drives the same handlers a click or key press reaches, without needing input permissions.
        if line.hasPrefix("menu "), let index = Int(line.dropFirst(5)) { menu.performActionForItem(at: index) }
        else if line == "real-hotkey" {
          // Hardware-level events: they travel the same path as a physical key press.
          for down in [true, false] {
            let event = CGEvent(keyboardEventSource: nil, virtualKey: 49, keyDown: down)
            event?.flags = [.maskControl, .maskAlternate]
            event?.post(tap: .cghidEventTap)
          }
        }
        else if line == "real-click", let window = item.button?.window {
          let frame = window.frame
          let screenHeight = NSScreen.screens[0].frame.height
          let point = CGPoint(x: frame.midX, y: screenHeight - frame.midY)
          for type in [CGEventType.leftMouseDown, CGEventType.leftMouseUp] {
            CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?
              .post(tap: .cghidEventTap)
          }
        }
        else if line.hasPrefix("real-row "), let row = Int(line.dropFirst(9)) {
          // Moves the real pointer over a row of the open menu and clicks it.
          let screenHeight = NSScreen.screens[0].frame.height
          let windows = NSApp.windows.filter { $0.frame.width > 100 && $0.level.rawValue > 0 && $0.frame.height > 60 && $0 != item.button?.window }
          guard let window = windows.max(by: { $0.frame.height < $1.frame.height }) else { emit("row:nomenu"); return }
          let frame = window.frame
          let rowHeight = (frame.height - 10) / CGFloat(menu.numberOfItems)
          let point = CGPoint(x: frame.midX, y: screenHeight - (frame.maxY - 5 - rowHeight * (CGFloat(row) + 0.5)))
          CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?
            .post(tap: .cghidEventTap)
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            for type in [CGEventType.leftMouseDown, CGEventType.leftMouseUp] {
              CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?
                .post(tap: .cghidEventTap)
            }
          }
        }
        else if line.hasPrefix("real-key "), let code = UInt16(line.dropFirst(9)) {
          for down in [true, false] {
            CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)?.post(tap: .cghidEventTap)
          }
        }
        else if line == "press-hotkey" {
          var event: EventRef?
          CreateEvent(nil, UInt32(kEventClassKeyboard), UInt32(kEventHotKeyPressed), 0, 0, &event)
          var id = EventHotKeyID(signature: OSType(0x504A4B59), id: 1)
          SetEventParameter(event, UInt32(kEventParamDirectObject), UInt32(typeEventHotKeyID), MemoryLayout<EventHotKeyID>.size, &id)
          SendEventToEventTarget(event, GetApplicationEventTarget())
        }
      }
    }
  }
  DispatchQueue.main.async { NSApp.terminate(nil) }
}
emit("ready")
app.run()
