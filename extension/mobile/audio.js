// Web Audio playback stays in the visible page; mobile browser workers cannot own a DOM audio element.
(function () {
  const WDub = globalThis.WDub;
  let context;
  let current;
  let epoch = 0;
  let lastSequence = -1;

  function ensureContext() {
    context ||= new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    return context;
  }

  function stop() {
    epoch++;
    if (!current) return;
    current.source.onended = null;
    try { current.source.stop(); } catch {}
    current = null;
  }

  WDub.MobileAudio = {
    unlock() {
      // Called directly inside the user's tap, before translation or network requests.
      try { ensureContext().resume().catch(() => {}); } catch {}
    },
    async handle(command) {
      if (Number.isFinite(command.sequence)) {
        if (command.sequence < lastSequence) return { started: false, cancelled: true };
        lastSequence = command.sequence;
      }
      const action = command.action;
      if (action === 'stop') return stop();
      if (action === 'pause') return context?.suspend();
      if (action === 'resume') return context?.resume();
      if (action === 'volume') {
        if (current) current.gain.gain.value = Math.max(0, Math.min(1, command.volume));
        return;
      }
      if (action !== 'play') return;
      stop();
      const mine = epoch;
      const binary = atob(command.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const ctx = ensureContext();
      const buffer = await ctx.decodeAudioData(bytes.buffer);
      if (mine !== epoch) return { started: false, cancelled: true };
      await ctx.resume();
      if (ctx.state !== 'running') throw new Error('手机阻止了配音播放，请再次点“开始配音”');
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      source.playbackRate.value = Math.max(0.5, Math.min(4, command.rate || 1));
      gain.gain.value = Math.max(0, Math.min(1, command.volume ?? 1));
      source.connect(gain).connect(ctx.destination);
      current = { source, gain, key: command.key };
      source.onended = () => {
        if (current?.source !== source) return;
        current = null;
        if (WDub.MobileAudio.onEnded) WDub.MobileAudio.onEnded(command.key);
        else chrome.runtime.sendMessage({ target: 'bg', type: 'ended', key: command.key, reason: 'end' }).catch(() => {});
      };
      source.start();
      return { started: true, duration: buffer.duration };
    }
  };
})();
