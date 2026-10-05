import { extname, join, relative, resolve, sep } from "node:path";

const inside = (file, directory) => file === directory || file.startsWith(directory + sep);

/** Root policy is explicit: a transit container never becomes one graph node. */
export function createBoundaries(rootOptions, projectRoot) {
  const roots = Object.entries(rootOptions).sort(([a], [b]) => b.length - a.length);

  function classify(file, base = projectRoot) {
    const absolute = resolve(base, file);
    for (const [root, options] of roots) {
      const directory = resolve(base, root);
      if (!inside(absolute, directory)) continue;
      const parts = relative(directory, absolute).split(sep);
      let module;
      let parentModule;
      let transit;
      if (parts[0] === "modules" && options.transitModules?.includes(parts[1])) {
        const container = join(directory, ...parts.slice(0, 2));
        const child = parts.length > 3 ? parts[2] : undefined;
        transit = {
          container,
          type: child === "_" ? "private" : child && child !== "modules" ? "submodule" : "container",
        };
        if (transit.type !== "container") module = join(container, child);
      }
      for (let i = transit ? 3 : 0; i < parts.length - 1; i++) {
        if (parts[i] === "modules" && parts[i + 1]) {
          parentModule = module;
          module = join(directory, ...parts.slice(0, i + 2));
        }
      }
      return { root, options, layer: parts[0], module, parentModule, transit, absolute };
    }
    return { absolute };
  }

  function boundaryError(from, to, base = projectRoot) {
    const source = classify(from, base);
    const target = classify(to, base);
    if (!target.root) return "Local dependency is outside the configured FEOD roots";
    if (
      (source.root === "src" ||
        (source.root === "core" &&
          !["app-paths", "os"].includes(
            relative(resolve(base, "core/modules"), source.absolute).split(sep)[0],
          ))) &&
      target.root === "core" &&
      ["app-paths", "os"].includes(
        relative(resolve(base, "core/modules"), target.absolute).split(sep)[0],
      )
    ) return "Browser/domain code cannot consume Node OS infrastructure";
    if (target.layer === "globals") return "Globals are ambient declarations and cannot be imported";
    if (!source.root) {
      if (target.layer !== "app" && target.layer !== "modules")
        return "Bootstrap may only consume app or public modules";
    } else {
      if (source.layer === "globals") return "Globals cannot import application code";
      if (
        source.root !== target.root &&
        !source.options.dependencies.some((p) => inside(target.absolute, resolve(base, p)))
      ) return "Dependency between these applications is forbidden";
    }

    const privateTransit = target.transit?.type === "private";
    if (target.transit?.type === "container")
      return "Transit containers have no public API; use a submodule index.ts";
    if (privateTransit) {
      if (
        source.transit?.container !== target.transit.container ||
        source.transit.type === "container"
      ) return "Transit private core is restricted to its own submodules";
    } else if (target.module && source.module !== target.module && target.module !== source.parentModule) {
      if (target.parentModule && source.module !== target.parentModule)
        return "A nested module is private to its parent";
      const publicFile = extname(target.module) ? target.module : join(target.module, "index.ts");
      if (target.absolute !== publicFile) return "Use the module public index.ts";
    }
    if (source.root && source.root !== target.root && target.layer !== "modules")
      return "Applications may only consume public modules from another root";
    if (source.layer === "common" && target.layer !== "common")
      return "Common cannot depend on business modules or upper layers";
    if (source.layer === "modules" && !["modules", "common"].includes(target.layer))
      return "Modules cannot import routes, middleware, pages or app";
    if (
      ["pages", "routes", "middlewares"].includes(source.layer) &&
      !["modules", "common"].includes(target.layer)
    ) return "Pages, routes and middleware are isolated; compose them in app";
  }

  return { classify, boundaryError };
}
