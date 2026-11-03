import { z } from "zod";

/** Раскрытые каталоги дерева файлов проекта. */
export const treeSessionSchema = z.array(z.string());
