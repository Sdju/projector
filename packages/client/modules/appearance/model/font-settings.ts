import { onMounted, ref } from "vue";
import {
  appearanceFontMax,
  appearanceFontMin,
  type AppearanceFontKey,
  type AppearanceFonts,
} from "@ai-projector/core/modules/appearance/index.ts";
import { useSectionAction } from "../../../common/utilities/use-section-action.ts";
import {
  appearanceFonts,
  applyAppearanceFonts,
  loadAppearanceFonts,
  saveAppearanceFonts,
} from "../appearance.ts";

/**
 * Draft content font sizes for a settings section. Preview updates live; commit persists the key.
 * The agent writes through `ide.appearance.fonts.set` on the workbench scope.
 */
export function useAppearanceFontSettings(keys: readonly AppearanceFontKey[]) {
  const draft = ref<AppearanceFonts>({ ...appearanceFonts.value });
  const { ready, busy, error, status, load: loadSection, perform } = useSectionAction();

  function preview(key: AppearanceFontKey, size: number) {
    draft.value = { ...draft.value, [key]: size };
    applyAppearanceFonts({ ...appearanceFonts.value, [key]: size });
  }

  async function commit(key: AppearanceFontKey) {
    const previous = { ...appearanceFonts.value };
    const patch = { [key]: draft.value[key] } as Partial<AppearanceFonts>;
    applyAppearanceFonts({ ...appearanceFonts.value, ...patch });
    await perform(
      async () => {
        const saved = await saveAppearanceFonts(patch);
        draft.value = { ...saved };
        return saved;
      },
      {
        errorFallback: "Не удалось сохранить размер шрифта",
        success: "Размер шрифта сохранён",
        rollback: () => {
          applyAppearanceFonts(previous);
          draft.value = { ...previous };
        },
      },
    );
  }

  onMounted(() => {
    void loadSection(async () => {
      const saved = await loadAppearanceFonts();
      draft.value = { ...saved };
    }, "Не удалось загрузить размеры шрифта");
  });

  return {
    draft,
    ready,
    busy,
    error,
    status,
    keys,
    min: appearanceFontMin,
    max: appearanceFontMax,
    preview,
    commit,
  };
}
