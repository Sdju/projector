import workletUrl from "./pcm-worklet.ts?worker&url";

export const DICTATION_SAMPLE_RATE = 16_000;
export const DICTATION_MAX_SECONDS = 5 * 60;

export function downsamplePcm(
  input: Float32Array,
  sourceRate: number,
  targetRate = DICTATION_SAMPLE_RATE,
): Float32Array {
  if (sourceRate <= 0 || targetRate <= 0) throw new Error("Некорректная частота дискретизации");
  if (sourceRate === targetRate) return input.slice(0);
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
  for (let index = 0; index < output.length; index++) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let at = start; at < end; at++) {
      sum += input[at] ?? 0;
      count++;
    }
    output[index] = count ? sum / count : (input[Math.min(start, input.length - 1)] ?? 0);
  }
  return output;
}

export function encodeWav(samples: Float32Array, sampleRate = DICTATION_SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at: number, value: string) => {
    for (let index = 0; index < value.length; index++)
      view.setUint8(at + index, value.charCodeAt(index));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

export function concatPcm(chunks: readonly Float32Array[], length: number): Float32Array {
  const result = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

interface RecorderEvents {
  level: (value: number) => void;
  elapsed: (seconds: number) => void;
  limit: () => void;
}

export class DictationRecorder {
  private context?: AudioContext;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode;
  private sink?: GainNode;
  private chunks: Float32Array[] = [];
  private length = 0;
  private startedAt = 0;
  private timer?: ReturnType<typeof setInterval>;
  private stopping?: Promise<ArrayBuffer>;

  private events: RecorderEvents;

  constructor(events: RecorderEvents) {
    this.events = events;
  }

  async start(): Promise<void> {
    if (this.context) throw new Error("Запись уже идёт");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.stream = stream;
    try {
      const context = new AudioContext();
      this.context = context;
      await context.audioWorklet.addModule(workletUrl);
      await context.resume();
      this.chunks = [];
      this.length = 0;
      this.source = context.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(context, "projector-pcm", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const chunk = event.data;
        this.chunks.push(chunk);
        this.length += chunk.length;
        let peak = 0;
        for (let index = 0; index < chunk.length; index += 16)
          peak = Math.max(peak, Math.abs(chunk[index] ?? 0));
        this.events.level(Math.min(1, peak * 3));
      };
      this.sink = context.createGain();
      this.sink.gain.value = 0;
      this.source.connect(this.node).connect(this.sink).connect(context.destination);
      this.startedAt = Date.now();
      this.events.elapsed(0);
      this.timer = setInterval(() => {
        const seconds = Math.min(DICTATION_MAX_SECONDS, (Date.now() - this.startedAt) / 1000);
        this.events.elapsed(seconds);
        if (seconds >= DICTATION_MAX_SECONDS) this.events.limit();
      }, 250);
    } catch (error) {
      await this.release();
      throw error;
    }
  }

  stop(): Promise<ArrayBuffer> {
    if (this.stopping) return this.stopping;
    const context = this.context;
    if (!context) return Promise.reject(new Error("Запись не начата"));
    this.stopping = (async () => {
      const chunks = this.chunks;
      const length = this.length;
      const sampleRate = context.sampleRate;
      await this.release();
      if (!length) throw new Error("Микрофон не вернул звук");
      return encodeWav(downsamplePcm(concatPcm(chunks, length), sampleRate));
    })();
    return this.stopping;
  }

  async cancel(): Promise<void> {
    await this.release();
  }

  private async release(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.node) this.node.port.onmessage = null;
    this.source?.disconnect();
    this.node?.disconnect();
    this.sink?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    const context = this.context;
    this.context = undefined;
    this.stream = undefined;
    this.source = undefined;
    this.node = undefined;
    this.sink = undefined;
    this.stopping = undefined;
    this.chunks = [];
    this.length = 0;
    this.events.level(0);
    if (context && context.state !== "closed") await context.close();
  }
}

export function dictationAvailable(): boolean {
  return Boolean(
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof globalThis.AudioContext === "function" &&
    typeof globalThis.AudioWorkletNode === "function",
  );
}
