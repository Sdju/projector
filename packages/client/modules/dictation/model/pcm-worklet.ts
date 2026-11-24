interface AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (): AudioWorkletProcessor;
};
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

class ProjectorPcmProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel?.length) this.port.postMessage(channel.slice(0));
    return true;
  }
}

registerProcessor("projector-pcm", ProjectorPcmProcessor);
