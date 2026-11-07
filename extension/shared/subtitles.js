// 字幕解析与断句。统一输出 cue：{ id, start, end, text, speaker? }，时间单位为秒。
(function () {
  const WDub = (globalThis.WDub = globalThis.WDub || {});
  const S = (WDub.Subs = {});

  const decodeEntities = (s) =>
    s.replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
      const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return map[e.toLowerCase()] ?? m;
    });

  const clean = (s) =>
    decodeEntities(String(s || ''))
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const parseTime = (t) => {
    const m = String(t).trim().replace(',', '.').match(/(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)/);
    if (!m) return NaN;
    return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3];
  };

  const finalize = (cues) =>
    cues
      .filter((c) => c.text && c.end > c.start)
      .sort((a, b) => a.start - b.start)
      .map((c, i) => ({ ...c, id: i }));

  // SRT 与 WebVTT 共用：按空行分块，找含 --> 的时间行
  S.parseSrt = S.parseVtt = function (raw) {
    const blocks = String(raw).replace(/\r/g, '').replace(/^﻿/, '').split(/\n{2,}/);
    const cues = [];
    for (const block of blocks) {
      const lines = block.split('\n');
      const ti = lines.findIndex((l) => l.includes('-->'));
      if (ti < 0) continue;
      const [a, b] = lines[ti].split('-->');
      const text = clean(lines.slice(ti + 1).join(' '));
      cues.push({ start: parseTime(a), end: parseTime(b.trim().split(/\s+/)[0]), text });
    }
    return S.mergeFragments(finalize(cues.filter((c) => isFinite(c.start) && isFinite(c.end))));
  };

  // YouTube timedtext json3。自动生成字幕（ASR）是逐词给出的，需要按词拼句。
  S.parseYouTubeJson3 = function (json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const events = (data.events || []).filter((e) => e.segs);
    const isAsr = events.some((e) => e.segs.length > 1 && e.segs.some((s) => s.tOffsetMs != null));
    if (isAsr) {
      const words = [];
      for (const e of events) {
        if (e.aAppend) continue;
        for (const seg of e.segs) {
          const w = (seg.utf8 || '').replace(/\n/g, ' ');
          if (!w.trim()) continue;
          const start = (e.tStartMs + (seg.tOffsetMs || 0)) / 1000;
          words.push({ w, start });
        }
      }
      // 每个词的结束时间取下一个词的开始
      const endOf = (i) => (i + 1 < words.length ? words[i + 1].start : words[i].start + 0.6);
      return S.wordsToSentences(words.map((x, i) => ({ ...x, end: Math.min(endOf(i), x.start + 1.5) })));
    }
    const cues = events.map((e) => ({
      start: e.tStartMs / 1000,
      end: (e.tStartMs + (e.dDurationMs || 2000)) / 1000,
      text: clean(e.segs.map((s) => s.utf8).join(''))
    }));
    return S.mergeFragments(finalize(cues));
  };

  // YouTube 旧版 XML（<text start dur> 或 srv3 的 <p t d>）
  S.parseYouTubeXml = function (xml) {
    const cues = [];
    const re = /<(?:text|p)\b([^>]*)>([\s\S]*?)<\/(?:text|p)>/g;
    let m;
    while ((m = re.exec(xml))) {
      const attr = (n) => (m[1].match(new RegExp(`\\b${n}="([^"]+)"`)) || [])[1];
      const ms = attr('t') != null;
      const start = ms ? +attr('t') / 1000 : +attr('start');
      const dur = ms ? +(attr('d') || 2000) / 1000 : +(attr('dur') || 2);
      cues.push({ start, end: start + dur, text: clean(m[2]) });
    }
    return S.mergeFragments(finalize(cues));
  };

  S.parseAny = function (raw, hint = '') {
    const text = String(raw).trim();
    if (text.startsWith('{')) return S.parseYouTubeJson3(text);
    if (text.startsWith('<')) return S.parseYouTubeXml(text);
    if (/^WEBVTT/.test(text) || /\.vtt/i.test(hint)) return S.parseVtt(text);
    return S.parseSrt(text);
  };

  S.fromTextTrack = function (track) {
    return S.mergeFragments(
      finalize(Array.from(track.cues || []).map((c) => ({ start: c.startTime, end: c.endTime, text: clean(c.text) })))
    );
  };

  const SENT_END = /[.!?。！？…]["'”’)\]]?$/;

  // 拼接两段文字：中日韩文字之间不加空格，拉丁文字之间加
  const WIDE = /[　-〿぀-ヿ㐀-鿿가-힯＀-￯]/;
  S.joinText = (a, b) => {
    a = a.trim();
    b = b.trim();
    if (!a || !b) return a + b;
    return WIDE.test(a.at(-1)) || WIDE.test(b[0]) ? a + b : `${a} ${b}`;
  };

  // 逐词时间轴 → 句子。优先等句末标点或换人；较短停顿不应把一句话切成两次翻译。
  // word 可带 speaker（语音识别的说话人分离结果）。
  S.wordsToSentences = function (words) {
    const out = [];
    let cur = null;
    for (const word of words) {
      const gap = cur ? word.start - cur.end : 0;
      const newSpeaker = cur && word.speaker != null && word.speaker !== cur.speaker;
      if (cur && (newSpeaker || gap > 1.2 || word.end - cur.start > 16 || cur.text.length > 300)) {
        out.push(cur);
        cur = null;
      }
      if (!cur) cur = { start: word.start, end: word.end, text: '', ...(word.speaker != null && { speaker: word.speaker }) };
      cur.text = S.joinText(cur.text, word.w);
      cur.end = word.end;
      if (SENT_END.test(cur.text) && cur.end - cur.start > 1) {
        out.push(cur);
        cur = null;
      }
    }
    if (cur) out.push(cur);
    return S.mergeFragments(finalize(out.map((c) => ({ ...c, text: clean(c.text) }))));
  };

  // 人工字幕常把一句话拆在多行里，把没说完的行合并，翻译和配音都会更自然
  S.mergeFragments = function (cues) {
    const out = [];
    for (const c of cues) {
      const prev = out.at(-1);
      const canMerge =
        prev &&
        prev.speaker === c.speaker && // 不同说话人的话不合并
        !SENT_END.test(prev.text) &&
        !/^(\[|>>|-\s)/.test(c.text) &&
        c.start - prev.end < 1.2 &&
        c.end - prev.start < 16 &&
        prev.text.length + c.text.length < 300;
      if (canMerge) {
        prev.text = S.joinText(prev.text, c.text);
        prev.end = Math.max(prev.end, c.end);
      } else out.push({ ...c });
    }
    return finalize(out);
  };

  // 长句分段显示：按标点切成不超过一行半的小段（中文约 32 字、英文约 90 个字符），
  // 播放时按进度依次显示，不会一次铺满三行。
  S.pieces = function (text, max) {
    if (!text) return [];
    // 中日韩文字占多数才按中文处理；夹几个汉字的英文句子仍按英文切，避免把单词切断
    const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length > text.replace(/\s/g, '').length * 0.3;
    max = max || (cjk ? 32 : 90);
    if (text.length <= max * 1.2) return [text];
    const parts = text.match(cjk ? /[^，。！？；：,.!?;:]+[，。！？；：,.!?;:]*/g : /[^,.!?;:]+[,.!?;:]*\s*/g) || [text];
    const out = [];
    for (let p of parts) {
      // 没有标点的超长片段：英文按空格、中文按字数硬切
      while (p.length > max) {
        let cut = cjk ? max : p.lastIndexOf(' ', max);
        if (cut < max / 2) cut = max;
        out.push(p.slice(0, cut));
        p = p.slice(cut);
      }
      const last = out.at(-1);
      if (last != null && (last + p).length <= max) out[out.length - 1] = last + p;
      else out.push(p);
    }
    return out.map((x) => x.trim()).filter(Boolean);
  };

  // frac：这句话已经播放的比例（0～1）。按字数比例挑出当前该显示的那一段
  S.pieceAt = function (text, frac) {
    const ps = S.pieces(text);
    if (ps.length < 2) return text;
    const total = ps.reduce((n, p) => n + p.length, 0);
    let acc = 0;
    for (const p of ps) {
      acc += p.length;
      if (frac * total < acc) return p;
    }
    return ps.at(-1);
  };

  // 从字幕文本里识别说话人：[张三] / 张三： / >> 换人 / - 换人
  S.extractSpeakers = function (cues) {
    let toggle = 0;
    let last = null;
    for (const c of cues) {
      let m;
      if (c.speaker != null) {
        // 语音识别已经分出说话人，直接沿用
        last = c.speaker;
        continue;
      }
      if ((m = c.text.match(/^\[([^\]]{1,24})\]\s*/)) || (m = c.text.match(/^([A-Z][\w .'-]{0,20}|[一-龥]{1,6})[:：]\s+/))) {
        c.speaker = m[1].trim();
        c.text = c.text.slice(m[0].length);
      } else if ((m = c.text.match(/^(>>|-)\s*/))) {
        toggle++;
        c.speaker = `S${toggle % 2}`;
        c.text = c.text.slice(m[0].length);
      } else if (last) c.speaker = last;
      last = c.speaker || last;
    }
    return cues;
  };

  const fmtTime = (t, sep = ',') => {
    const ms = Math.round(t * 1000);
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
  };

  S.toSrt = (cues, field = 'tr') =>
    cues.map((c, i) => `${i + 1}\n${fmtTime(c.start)} --> ${fmtTime(c.end)}\n${c[field] || c.text}\n`).join('\n');

  S.fmtClock = (t) => {
    t = Math.max(0, t | 0);
    const m = Math.floor(t / 60), s = t % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };
})();
