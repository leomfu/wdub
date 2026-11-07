// 运行在网页主环境（MAIN world）：截获播放器自己请求的字幕，并提供 YouTube 播放器信息。
// 只读取字幕类响应，不修改任何请求。
(function () {
  if (window.__wdubHooked) return;
  window.__wdubHooked = true;

  const SUB_URL = /\/api\/timedtext|\.vtt(\?|$)|\.srt(\?|$)|[?&](fmt|format)=(json3|vtt|srv3|ttml)|subtitle|caption/i;
  const MAX = 8 * 1024 * 1024;

  // 页面可能在扩展主脚本启动前就请求了字幕，先存一份，主脚本启动后会要求重发
  const buffered = [];
  const emit = (url, body) => {
    if (!body || body.length > MAX) return;
    buffered.push({ url: String(url), body });
    if (buffered.length > 12) buffered.shift();
    window.postMessage({ __wdub: 'subs', url: String(url), body }, '*');
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input?.url;
      if (url && SUB_URL.test(url)) {
        p.then((res) => res.clone().text().then((t) => emit(url, t))).catch(() => {});
      }
    } catch {}
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (url && SUB_URL.test(String(url))) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType === '' || this.responseType === 'text') emit(url, this.responseText);
        } catch {}
      });
    }
    return origOpen.apply(this, arguments);
  };

  // ---- YouTube：读取播放器信息、让播放器加载某条字幕轨 ----
  const ytPlayer = () => document.getElementById('movie_player');

  function ytInfo() {
    const player = ytPlayer();
    const resp = player?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
    const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    return {
      videoId: resp?.videoDetails?.videoId,
      title: resp?.videoDetails?.title,
      isLive: !!resp?.videoDetails?.isLiveContent && !!resp?.playabilityStatus?.liveStreamability,
      tracks: tracks.map((t) => ({
        lang: t.languageCode,
        name: t.name?.simpleText || t.name?.runs?.map((r) => r.text).join('') || t.languageCode,
        asr: t.kind === 'asr'
      }))
    };
  }

  function ytLoadTrack(lang) {
    const player = ytPlayer();
    if (!player?.setOption) return false;
    try {
      player.loadModule?.('captions');
      player.setOption('captions', 'track', { languageCode: lang });
      return true;
    } catch {
      return false;
    }
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.__wdub !== 'ask') return;
    let result = null;
    if (d.what === 'ytInfo') result = ytInfo();
    if (d.what === 'ytLoadTrack') result = ytLoadTrack(d.lang);
    if (d.what === 'replaySubs') {
      for (const s of buffered) window.postMessage({ __wdub: 'subs', ...s }, '*');
      result = buffered.length;
    }
    window.postMessage({ __wdub: 'answer', id: d.id, result }, '*');
  });
})();
