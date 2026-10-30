import type { Component } from "vue";
import IconAlert from "~icons/lucide/circle-alert";
import IconArrowRight from "~icons/lucide/arrow-right";
import IconCheck from "~icons/lucide/check";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconCircleCheck from "~icons/lucide/circle-check";
import IconClock from "~icons/lucide/clock";
import IconCloud from "~icons/lucide/cloud";
import IconCode from "~icons/lucide/code";
import IconDatabase from "~icons/lucide/database";
import IconExternalLink from "~icons/lucide/external-link";
import IconFile from "~icons/lucide/file";
import IconFolder from "~icons/lucide/folder";
import IconGitBranch from "~icons/lucide/git-branch";
import IconGitCommit from "~icons/lucide/git-commit";
import IconInfo from "~icons/lucide/info";
import IconLock from "~icons/lucide/lock";
import IconPackage from "~icons/lucide/package";
import IconPlay from "~icons/lucide/play";
import IconSearch from "~icons/lucide/search";
import IconSettings from "~icons/lucide/settings";
import IconSparkles from "~icons/lucide/sparkles";
import IconTerminal from "~icons/lucide/terminal";
import IconTestTube from "~icons/lucide/test-tube";
import IconX from "~icons/lucide/x";

/** The same names the prompt documents; a new one must be added here and in the definition. */
export const icons: Record<string, Component> = {
  alert: IconAlert,
  "arrow-right": IconArrowRight,
  check: IconCheck,
  "chevron-right": IconChevronRight,
  "circle-check": IconCircleCheck,
  clock: IconClock,
  cloud: IconCloud,
  code: IconCode,
  database: IconDatabase,
  "external-link": IconExternalLink,
  file: IconFile,
  folder: IconFolder,
  "git-branch": IconGitBranch,
  "git-commit": IconGitCommit,
  info: IconInfo,
  lock: IconLock,
  package: IconPackage,
  play: IconPlay,
  search: IconSearch,
  settings: IconSettings,
  sparkles: IconSparkles,
  terminal: IconTerminal,
  "test-tube": IconTestTube,
  x: IconX,
};
