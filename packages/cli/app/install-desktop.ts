import { fileURLToPath } from "node:url";
import { os } from "@projector-ai/core/modules/os/index.ts";

os.installDesktop(fileURLToPath(new URL("../../..", import.meta.url)));
