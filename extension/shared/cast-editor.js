// 「配音声音 + 多人配音 + 说话人」：工具栏弹窗和视频上的面板（悬浮球、播放栏设置按钮）共用。
// 只负责界面；声音列表、视频里认出的说话人、保存、试听和「识别人物」由使用方传进来。
//
// 新保存的是 { id, voice, video? }。video 只加在 spk:、asr:、S0、S1 上，因为这些编号每个视频都从头计。
(function () {
  const WDub = globalThis.WDub;
  const mk = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids);
    return n;
  };
  const option = ([v, t]) => mk('option', { value: v, textContent: t });
  const MAX_VIDEO_ENTRIES = 60; // 按视频记的声音最多留这么多条，旧的自动丢掉
  const SEX = { m: '男', f: '女' };

  class CastEditor {
    // rowClass：每一行的样式类（弹窗是 field，面板是 row）
    // onSave(路径, 值)；onTry(声音) 试听；onDetect() 一键识别人物
    constructor({ rowClass, onSave, onTry, onDetect, onCorrect, onJump, allowDetect = true }) {
      this.onSave = onSave;
      this.onTry = onTry;
      this.onCorrect = onCorrect;
      this.onJump = onJump;
      this.detectOpen = false;
      this.allowDetect = allowDetect !== false;
      this.voice = mk('select');
      this.voice.addEventListener('change', () => onSave(`cast.${this.engine}.narrator`, this.voice.value));
      this.multi = mk('input', { type: 'checkbox' });
      this.multi.addEventListener('change', () => onSave('multiVoice', this.multi.checked));

      if (this.allowDetect) {
        this.detectToggle = mk('button', { type: 'button', className: 'detect detect-toggle', textContent: '识别人物', title: '听声音分出视频里有几个人、每句是谁说的，并按男女分好声音', ariaExpanded: 'false' });
        this.detectToggle.addEventListener('click', () => {
          this.detectOpen = !this.detectOpen;
          this.detectPanel.hidden = !this.detectOpen;
          this.detectToggle.setAttribute('aria-expanded', String(this.detectOpen));
        });
        this.startDetect = mk('button', { type: 'button', className: 'detect', textContent: '开始识别' });
        this.startDetect.addEventListener('click', () => onDetect?.());
        this.count = mk('select', { className: 'count', title: '视频里有几个人说话；知道人数时选上，分得更准' },
          ...[[0, '人数自动'], [2, '2 人'], [3, '3 人'], [4, '4 人'], [5, '5 人']].map(option));
        this.count.addEventListener('change', () => onSave('diarize.count', Number(this.count.value)));
        this.job = mk('p', { className: 'job' });
        this.detectPanel = mk('div', { className: 'detect-panel', hidden: true }, mk('div', { className: 'detect-row' }, this.startDetect, this.count), this.job);
      }
      this.cueText = mk('div', { className: 'cue-text' });
      this.cueSpeaker = mk('select', { title: '这句是谁说的' });
      this.cueGender = mk('select', { title: '这句使用男声还是女声' },
        option(['u', '性别未知']), option(['m', '男声']), option(['f', '女声']));
      const prev = mk('button', { type: 'button', textContent: '‹ 上一句' });
      const next = mk('button', { type: 'button', textContent: '下一句 ›' });
      prev.addEventListener('click', () => this.onJump?.(-1));
      next.addEventListener('click', () => this.onJump?.(1));
      const apply = mk('button', { type: 'button', className: 'apply', textContent: '保存这句' });
      apply.addEventListener('click', () => this.editingKey && this.onCorrect?.({ key: this.editingKey,
        speaker: this.cueSpeaker.value, gender: this.cueGender.value }));
      this.cueFix = mk('div', { className: 'cue-fix', hidden: true },
        mk('div', { className: 'cue-nav' }, prev, this.cueText, next),
        mk('div', { className: 'cue-fields' }, this.cueSpeaker, this.cueGender, apply),
        mk('div', { className: 'cue-note', textContent: '男女声设置会用于所选人物的全部句子' }));
      this.rows = mk('div');
      const add = mk('button', { className: 'add', textContent: '＋ 添加说话人' });
      add.addEventListener('click', () => {
        this.focusNew = true;
        this.savePeople([...this.list, { id: '', voice: this.narrator }]);
      });
      this.people = mk('div', { className: 'people' }, ...(this.allowDetect ? [this.detectToggle, this.detectPanel] : []), this.cueFix, this.rows, add);

      this.el = mk(
        'div',
        { className: 'cast' },
        mk('div', { className: rowClass }, mk('label', { textContent: '配音声音' }), this.voice, this.playBtn(() => this.voice.value)),
        mk('div', { className: rowClass }, mk('label', { textContent: '多人配音' }), mk('span', { className: 'grow', textContent: '每个说话人用不同声音' }), mk('span', { className: 'switch' }, this.multi, mk('span'))),
        this.people
      );
      this.state = {};
    }

    playBtn(getVoice) {
      const b = mk('button', { className: 'play', textContent: '▶', title: '试听这个声音' });
      b.addEventListener('click', () => this.onTry(getVoice()));
      return b;
    }

    get list() {
      return this.state.s?.cast[this.engine]?.people || [];
    }

    get narrator() {
      return this.state.s?.cast[this.engine]?.narrator || this.state.options?.[0]?.[0] || '';
    }

    savePeople(list) {
      // 按视频记的条目只留最近的一批
      const scoped = list.filter((p) => p.video);
      const drop = new Set(scoped.slice(0, Math.max(0, scoped.length - MAX_VIDEO_ENTRIES)));
      this.onSave(`cast.${this.engine}.people`, list.filter((p) => !drop.has(p)));
    }

    // 这个说话人对应的设置条目：一键识别出的按视频找，其余找通用的
    entryOf(sp, list) {
      return WDub.findVoiceBinding(list, sp.id, this.state.video);
    }

    // 传入有变化的部分即可：s 设置；engine、options 实际在用的配音引擎和它的声音；
    // speakers 视频里认出的说话人；job 识别人物的进度；video 当前视频
    update(part) {
      Object.assign(this.state, part);
      const { s, engine, options = [], speakers = [], currentCue, job, video } = this.state;
      if (!s || !engine) return;
      this.engine = engine;
      const focused = this.el.getRootNode().activeElement; // 面板在 Shadow DOM 里，焦点要从所在的根节点上看

      // 主声音（系统声音多一个「自动」）
      const cur = s.cast[engine]?.narrator || '';
      const opts = [...(engine === 'system' ? [['', '自动（跟随翻译语言）']] : []), ...options, ...(cur && !options.some(([v]) => v === cur) ? [[cur, cur]] : [])];
      const vsig = JSON.stringify(opts);
      if (vsig !== this.vsig && focused !== this.voice) {
        this.vsig = vsig;
        this.voice.replaceChildren(...opts.map(option));
      }
      this.voice.value = cur;
      this.multi.checked = !!s.multiVoice;
      this.people.hidden = !s.multiVoice;
      if (this.detectPanel) this.detectPanel.hidden = !this.detectOpen;
      if (this.count && focused !== this.count) this.count.value = String(s.diarize?.count || 0);
      if (this.startDetect) {
        this.startDetect.disabled = !!job?.running;
        this.startDetect.textContent = job?.running ? '识别中…' : '开始识别';
      }
      if (this.job) {
        this.job.className = 'job' + (job?.error ? ' err' : '');
        this.job.textContent = job?.error ? `没能识别：${job.error}` : job?.text || (speakers.length ? '' : '点「开始识别」，听出视频里有几个人、每句是谁说的，并按男女分好声音。');
      }

      this.cueFix.hidden = !currentCue;
      if (currentCue && focused !== this.cueSpeaker && focused !== this.cueGender) {
        const entries = [['', '未指定'], ...speakers.map((sp) => [sp.id, sp.label]), ['__new__', '＋ 新人物']];
        if (currentCue.speaker && !entries.some(([id]) => id === currentCue.speaker)) {
          entries.splice(1, 0, [currentCue.speaker, WDub.speakerLabel(currentCue.speaker)]);
        }
        const sig = JSON.stringify([currentCue.key, currentCue.speaker, currentCue.gender, entries]);
        if (sig !== this.cueSig) {
          this.cueSig = sig;
          this.editingKey = currentCue.key;
          this.cueText.textContent = `${currentCue.index + 1}/${currentCue.total} · ${currentCue.text.slice(0, 65)}`;
          this.cueSpeaker.replaceChildren(...entries.map(option));
          this.cueSpeaker.value = currentCue.speaker;
          this.cueGender.value = currentCue.gender;
        }
      }

      // 说话人：识别出来的每人一行（名字固定，只选声音），手动添加的可以改名、删除。正在操作时不重建
      const list = this.list;
      const sig = JSON.stringify([engine, video, list, speakers.map((sp) => [sp.id, sp.voice, sp.count, sp.gender]), options.map(([v]) => v)]);
      if (sig !== this.sig && !this.rows.contains(focused)) {
        this.sig = sig;
        const used = new Set();
        const found = speakers.map((sp) => {
          const i = this.entryOf(sp, list);
          if (i >= 0) used.add(i);
          return this.foundRow(sp, i, list, options);
        });
        const manual = list.map((p, i) => [p, i]).filter(([p, i]) => !used.has(i) && (!p.video || p.video === video)).map(([p, i]) => this.manualRow(p, i, list, options));
        this.rows.replaceChildren(...found, ...manual);
        if (this.focusNew) {
          this.focusNew = false;
          this.rows.lastElementChild?.querySelector('input')?.focus();
        }
      }
    }

    voiceSelect(value, options, onChange) {
      const sel = mk('select', {}, ...options.map(option));
      if (value && !options.some(([v]) => v === value)) sel.append(option([value, value]));
      sel.value = value || this.narrator;
      sel.addEventListener('change', () => onChange(sel.value));
      return sel;
    }

    // 视频里认出的说话人：说话人1 · 男 · 32 句 + 声音 + 试听
    foundRow(sp, i, list, options) {
      const who = mk('span', { className: 'who', title: `${sp.label}：${sp.count} 句` },
        mk('b', { textContent: sp.label }), mk('small', { textContent: [SEX[sp.gender], `${sp.count} 句`].filter(Boolean).join(' · ') }));
      const sel = this.voiceSelect(i >= 0 ? list[i].voice : sp.voice, options, (voice) => {
        const entry = WDub.voicePerson(sp.id, voice, this.state.video);
        if (!entry) return;
        this.savePeople(i >= 0 ? list.map((x, k) => (k === i ? entry : x)) : [...list, entry]);
      });
      return mk('div', { className: 'person found' }, who, sel, this.playBtn(() => sel.value));
    }

    // 手动添加的：人物名 + 声音 + 删除
    manualRow(p, i, list, options) {
      const update = (patch) => {
        const voice = patch.voice ?? p.voice;
        const id = patch.id != null ? patch.id : (p.id || p.name || '');
        const person = WDub.voicePerson(id, voice, this.state.video) || { id: '', voice: voice ?? '' };
        this.savePeople(list.map((x, k) => (k === i ? person : x)));
      };
      const name = mk('input', { type: 'text', value: p.id || p.name || '', placeholder: '人物名，如 A' });
      name.addEventListener('change', () => update({ id: name.value.trim() }));
      const sel = this.voiceSelect(p.voice, options, (voice) => update({ voice }));
      const rm = mk('button', { className: 'rm', textContent: '✕', title: '删除' });
      rm.addEventListener('click', () => this.savePeople(list.filter((_, k) => k !== i)));
      return mk('div', { className: 'person' }, name, sel, rm);
    }
  }

  WDub.CastEditor = CastEditor;
})();
