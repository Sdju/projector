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

interface RecorderSession {
  /** The start this session belongs to; a newer start or a cancel makes it stale. */
  token: number;
  context: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode;
  sink: GainNode;
  chunks: Float32Array[];
  length: number;
  startedAt: number;
  timer?: ReturnType<typeof setInterval>;
}

function aborted(): DOMException {
  return new DOMException("Запись отменена", "AbortError");
}

/** Stops and closes one session; every step is guarded so a half-built session still closes. */
async function releaseSession(session: RecorderSession): Promise<void> {
  if (session.timer) clearInterval(session.timer);
  session.node.port.onmessage = null;
  try {
    session.source.disconnect();
  } catch {
    // The node may already be detached.
  }
  try {
    session.node.disconnect();
  } catch {
    // The node may already be detached.
  }
  try {
    session.sink.disconnect();
  } catch {
    // The node may already be detached.
  }
  for (const track of session.stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // A stopped track is already fine.
    }
  }
  if (session.context.state !== "closed") await session.context.close().catch(() => undefined);
}

/**
 * One microphone recording. Starts and cancels may overlap: each start has a token, and only
 * the newest token may keep its session. This is what stops a cancelled start from leaving an
 * `AudioContext` behind while the UI already thinks recording is idle.
 */
export class DictationRecorder {
  private session?: RecorderSession;
  private starting?: Promise<void>;
  private token = 0;
  private stopping?: Promise<ArrayBuffer>;

  private events: RecorderEvents;

  constructor(events: RecorderEvents) {
    this.events = events;
  }

  start(): Promise<void> {
    if (this.session) return Promise.reject(new Error("Запись уже идёт"));
    const token = ++this.token;
    const starting = this.begin(token);
    this.starting = starting;
    return starting.finally(() => {
      if (this.starting === starting) this.starting = undefined;
    });
  }

  private async begin(token: number): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let node: AudioWorkletNode | undefined;
    let sink: GainNode | undefined;
    try {
      if (token !== this.token) throw aborted();
      context = new AudioContext();
      await context.audioWorklet.addModule(workletUrl);
      if (token !== this.token) throw aborted();
      await context.resume();
      if (token !== this.token) throw aborted();
      source = context.createMediaStreamSource(stream);
      node = new AudioWorkletNode(context, "projector-pcm", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      sink = context.createGain();
      sink.gain.value = 0;
      source.connect(node).connect(sink).connect(context.destination);
      if (token !== this.token) throw aborted();
      const session: RecorderSession = {
        token,
        context,
        stream,
        source,
        node,
        sink,
        chunks: [],
        length: 0,
        startedAt: Date.now(),
      };
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (this.session !== session) return;
        const chunk = event.data;
        session.chunks.push(chunk);
        session.length += chunk.length;
        let peak = 0;
        for (let index = 0; index < chunk.length; index += 16)
          peak = Math.max(peak, Math.abs(chunk[index] ?? 0));
        this.events.level(Math.min(1, peak * 3));
      };
      session.timer = setInterval(() => {
        if (this.session !== session) return;
        const seconds = Math.min(DICTATION_MAX_SECONDS, (Date.now() - session.startedAt) / 1000);
        this.events.elapsed(seconds);
        if (seconds >= DICTATION_MAX_SECONDS) this.events.limit();
      }, 250);
      this.events.elapsed(0);
      this.session = session;
    } catch (error) {
      if (node) node.port.onmessage = null;
      try {
        source?.disconnect();
      } catch {
        // The node may already be detached.
      }
      try {
        node?.disconnect();
      } catch {
        // The node may already be detached.
      }
      try {
        sink?.disconnect();
      } catch {
        // The node may already be detached.
      }
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // A stopped track is already fine.
        }
      }
      if (context && context.state !== "closed") await context.close().catch(() => undefined);
      throw error;
    }
  }

  stop(): Promise<ArrayBuffer> {
    if (this.stopping) return this.stopping;
    const token = this.token;
    const promise = this.finish(token);
    this.stopping = promise;
    void promise
      .finally(() => {
        if (this.stopping === promise) this.stopping = undefined;
      })
      .catch(() => undefined);
    void promise.catch(() => undefined);
    return promise;
  }

  private async finish(token: number): Promise<ArrayBuffer> {
    // Stop pressed while the microphone was still being opened: wait for that start, then stop
    // the session it produced. A cancelled or superseded start simply leaves nothing to stop.
    let failure: unknown;
    if (this.starting) await this.starting.catch((error) => (failure = error));
    const session = this.session;
    if (!session || session.token !== token) {
      if (failure instanceof DOMException && failure.name === "NotAllowedError")
        throw new Error("Разрешите доступ к микрофону в браузере");
      if (failure instanceof DOMException && failure.name === "AbortError")
        throw new Error("Запись отменена");
      throw failure instanceof Error ? failure : new Error("Запись не начата");
    }
    this.session = undefined;
    const { chunks, length, context } = session;
    const sampleRate = context.sampleRate;
    await releaseSession(session);
    if (!length) throw new Error("Микрофон не вернул звук");
    return encodeWav(downsamplePcm(concatPcm(chunks, length), sampleRate));
  }

  async cancel(): Promise<void> {
    this.token++;
    this.starting = undefined;
    this.stopping = undefined;
    const session = this.session;
    this.session = undefined;
    this.events.level(0);
    if (session) await releaseSession(session);
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
