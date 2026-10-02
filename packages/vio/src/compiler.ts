import { parse, compileScript, compileStyle, compileTemplate, type CompilerOptions } from "@vue/compiler-sfc";
import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { existsSync, readFileSync, realpathSync } from "node:fs";

/** Compile SFCs for runtime-core rather than the DOM compiler/runtime. */
export function compileSfc(source: string, filename: string): string {
  const { descriptor, errors } = parse(source, { filename });
  if (errors.length) throw new Error(`vio: ${filename}: ${errors.map(String).join("\n")}`);
  if (descriptor.template?.src || descriptor.script?.src || descriptor.scriptSetup?.src || descriptor.styles.some(style => style.src)) {
    throw new Error("vio: external SFC blocks are not supported; import a component or CSS module instead");
  }
  if (descriptor.template?.lang && descriptor.template.lang !== "html") throw new Error("vio: templates must use HTML syntax");
  if (descriptor.styles.some(style => style.lang && style.lang !== "css")) throw new Error("vio: styles must use GTK CSS");
  const id = `vio-${createHash("sha256").update(filename).digest("hex").slice(0, 10)}`;
  // compileScript requires at least one script block, even for template-only components.
  if (!descriptor.script && !descriptor.scriptSetup) {
    if (!descriptor.template) throw new Error("vio: an SFC needs a template or script");
    descriptor.script = { type: "script", content: "export default {}", loc: descriptor.template.loc, attrs: {} };
  }
  const compilerOptions: CompilerOptions = {
    runtimeModuleName: "vio", hoistStatic: false,
    isCustomElement: tag => tag.startsWith("gtk-"),
    nodeTransforms: [node => {
      if (node.type !== 1) return;
      for (const prop of node.props) {
        if (prop.type !== 7) continue;
        if (["html", "text"].includes(prop.name)) throw new Error(`vio: v-${prop.name} is a DOM directive; use VLabel interpolation`);
        if (prop.name === "model" && node.tag !== "VEntry") throw new Error("vio: v-model is supported on VEntry; use GTK properties/signals for other widgets");
        if (prop.name === "on" && prop.modifiers.some(modifier => modifier.content !== "once")) throw new Error("vio: DOM event modifiers are not supported; GTK event handlers return true to consume an event");
      }
    }],
  };
  const script = compileScript(descriptor, {
    id, genDefaultAs: "__vio_component", inlineTemplate: true,
    fs: { fileExists: existsSync, readFile: filename => readFileSync(filename, "utf8"), realpath: realpathSync },
    templateOptions: {
      compilerOptions,
    },
  });
  const styles = descriptor.styles.map(style => {
    const result = compileStyle({ source: style.content, filename, id, scoped: style.scoped });
    if (result.errors.length) throw new Error(`vio: ${filename}: ${result.errors.map(String).join("\n")}`);
    // GTK has CSS classes but no DOM data-* attributes.
    return result.code.replaceAll(`[${id}]`, `.${id}`).replaceAll(`[data-v-${id}]`, `.${id}`);
  }).join("\n");
  let code = script.content.replace(/from\s*(['"])vue\1/g, 'from "vio"');
  if (!descriptor.scriptSetup && descriptor.template) {
    const result = compileTemplate({ source: descriptor.template.content, filename, id, compilerOptions: { ...compilerOptions, bindingMetadata: script.bindings } });
    if (result.errors.length) throw new Error(`vio: ${filename}: ${result.errors.map(String).join("\n")}`);
    code += `\n${result.code.replace("export function render", "function __vio_render")}\n__vio_component.render = __vio_render;\n`;
  }
  if (styles) code += `\nimport { withStyles as __vio_withStyles } from 'vio';\nexport default __vio_withStyles(__vio_component, ${JSON.stringify(styles)}, ${descriptor.styles.some(style => style.scoped) ? JSON.stringify(id) : "undefined"});\n`;
  else code += "\nexport default __vio_component;\n";
  return (descriptor.script?.lang === "ts" || descriptor.scriptSetup?.lang === "ts") ? stripTypeScriptTypes(code) : code;
}
