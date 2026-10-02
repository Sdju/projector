import Gtk from "gi:Gtk-4.0";
import GLib from "gi:GLib-2.0";
import { createApp } from "vio";
import Counter from "./Counter.vue";

Gtk.init();
const loop = GLib.MainLoop.new(null, false);
const app = createApp(Counter, { quit: () => { app.unmount(); loop.quit(); } });
app.mount();
loop.run();
