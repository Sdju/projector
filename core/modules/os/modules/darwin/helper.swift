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

final class Target: NSObject {
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
item.menu = menu

DispatchQueue.global().async {
  while let line = readLine() {
    DispatchQueue.main.async {
      if line.hasPrefix("hotkey ") { emit(registerHotkey(String(line.dropFirst(7)))) }
      else if line == "quit" { NSApp.terminate(nil) }
    }
  }
  DispatchQueue.main.async { NSApp.terminate(nil) }
}
emit("ready")
app.run()
