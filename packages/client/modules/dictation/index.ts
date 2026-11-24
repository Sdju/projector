export {
  DICTATION_MAX_SECONDS,
  DICTATION_SAMPLE_RATE,
  DictationRecorder,
  concatPcm,
  dictationAvailable,
  downsamplePcm,
  encodeWav,
} from "./model/recorder.ts";
export { useDictation, type DictationPhase } from "./model/use-dictation.ts";
