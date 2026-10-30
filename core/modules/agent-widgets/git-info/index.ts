import { defineWidget } from "../../widget-catalog/index.ts";

export const gitInfoWidget = defineWidget({
  name: "GitInfo",
  group: "data",
  summary:
    "состояние и история git: ветка, изменения, diff, коммиты — когда ответ опирается на репозиторий",
  props: {
    branch: { type: "string", description: "текущая ветка" },
    upstream: { type: "string", description: "upstream-ветка, например origin/main" },
    ahead: { type: "number", description: "коммитов впереди upstream" },
    behind: { type: "number", description: "коммитов позади upstream" },
    clean: { type: "boolean", description: "рабочее дерево чистое" },
    staged: { type: "number", description: "изменений в индексе" },
    unstaged: { type: "number", description: "неиндексированных изменений" },
    untracked: { type: "number", description: "неотслеживаемых файлов" },
    conflicted: { type: "number", description: "конфликтующих файлов" },
    additions: { type: "number", description: "добавленных строк в diff" },
    deletions: { type: "number", description: "удалённых строк в diff" },
    commits: {
      type: "[{hash, subject, author?, when?}]",
      description: "последние коммиты; when — готовая подпись времени",
    },
    files: {
      type: "[{path, status?, additions?, deletions?}]",
      description: "изменённые файлы; status — M, A, D, R и т. п.",
    },
  },
  special: true,
  example:
    '<GitInfo branch="main" upstream="origin/main" :ahead="2" :staged="3" :unstaged="1" :untracked="2" :additions="48" :deletions="12" :commits="[{hash:\'a1b2c3d\',subject:\'Добавить GitInfo\',author:\'Ада\',when:\'2 ч назад\'}]" :files="[{path:\'core/modules/agent-widgets/git-info/index.ts\',status:\'A\',additions:48,deletions:0}]" />',
});
