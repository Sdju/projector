# @ai-projector/native

Optional GTK palette and GIO application catalog for Projector. Install it in the same npm prefix as `@ai-projector/ide`.

## Install

```bash
npm install -g @ai-projector/native
projector --native
```

Requirements: the IDE package of the same version, GTK4, GObject Introspection, `pkg-config` and a C++ compiler for `node-gtk`. On Linux, install the GTK4 development packages before npm install.

The GTK palette runs in a separate helper process. Without this package Projector opens the browser and keeps the tray/hotkey resident without GTK.
