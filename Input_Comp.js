/* ============================================================
   Input_Comp.js – Composant Input universel CONCORDE
   CSP-strict : 0 style= attribut HTML inline, 0 onclick= inline
   Dropdowns en portal sur document.body (jamais clippés)
   Types : text, password, email, tel, number, textarea,
           select (single), multiselect, date, time, datetime
   ============================================================ */

/* ── SVG ────────────────────────────────────────────────────── */
const IC_SVG = {
  eye:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
  close:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  chevronDown:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  chevronUp:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`,
  chevronLeft:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
  chevronRight:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
  check:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  checkCircle:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  alertCircle:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>`,
  calendar:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  clock:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  search:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  user:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  mail:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
  phone:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8 19.79 19.79 0 01.01 2.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>`,
  lock:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,
  hash:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`,
};

const FR_MONTHS_LONG  = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const FR_MONTHS_SHORT = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

/* ══════════════════════════════════════════════════════════════
   PORTAL MANAGER
   Attache les dropdowns directement sur document.body et les
   positionne via getBoundingClientRect() — jamais clippés par
   overflow:hidden/scroll de n'importe quel parent.
══════════════════════════════════════════════════════════════ */
const IC_Portal = {
  attach(dropdown, anchor, minWidth) {
    document.body.appendChild(dropdown);
    this._reposition(dropdown, anchor, minWidth);
    // Écoutes scroll/resize sur toute la chaîne de parents
    this._handlers = [
      [window, 'scroll', () => this._reposition(dropdown, anchor, minWidth), true],
      [window, 'resize', () => this._reposition(dropdown, anchor, minWidth)],
    ];
    this._handlers.forEach(([el, ev, fn, cap]) => el.addEventListener(ev, fn, cap));
    dropdown._icAnchor   = anchor;
    dropdown._icMinWidth = minWidth;
  },

  detach(dropdown) {
    if (dropdown && dropdown.parentNode) dropdown.parentNode.removeChild(dropdown);
    if (this._handlers) {
      this._handlers.forEach(([el, ev, fn, cap]) => el.removeEventListener(ev, fn, cap));
      this._handlers = null;
    }
  },

  reposition(dropdown) {
    if (dropdown && dropdown._icAnchor) {
      this._reposition(dropdown, dropdown._icAnchor, dropdown._icMinWidth);
    }
  },

  _reposition(drop, anchor, minWidth) {
    const rect    = anchor.getBoundingClientRect();
    const vpH     = window.innerHeight;
    const vpW     = window.innerWidth;
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const scrollX = window.scrollX || document.documentElement.scrollLeft;

    // Largeur du dropdown
    const w = minWidth || rect.width;
    drop.style.setProperty('--ic-drop-width', (typeof w === 'number' ? w : parseInt(w) || rect.width) + 'px');

    // Hauteur estimée (avant positionnement, le dropdown peut ne pas être visible)
    const dropH = drop.offsetHeight || 340;

    // Ouvre en haut ou en bas ?
    const spaceBelow = vpH - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const openAbove  = spaceBelow < dropH && spaceAbove > spaceBelow;

    const top = openAbove
      ? rect.top  + scrollY - dropH - 4
      : rect.bottom + scrollY + 4;

    // Aligne à gauche, mais évite le débordement droit
    let left = rect.left + scrollX;
    const dropW = parseInt(drop.style.getPropertyValue('--ic-drop-width')) || rect.width;
    if (left + dropW > vpW + scrollX - 8) left = vpW + scrollX - dropW - 8;
    if (left < scrollX + 8) left = scrollX + 8;

    drop.style.setProperty('--ic-drop-top',  top  + 'px');
    drop.style.setProperty('--ic-drop-left', left + 'px');
    drop.classList.toggle('ic-drop-above', openAbove);
  },
};

/* ══════════════════════════════════════════════════════════════
   CLASSE PRINCIPALE InputComp
══════════════════════════════════════════════════════════════ */
class InputComp {
  constructor(element, options = {}) {
    const defaults = {
      type:        'text',
      label:       '',
      placeholder: '',
      required:    false,
      disabled:    false,
      readonly:    false,
      size:        'md',
      value:       '',
      name:        '',
      id:          '',
      autocomplete:'off',
      showPassword: false,
      clearable:    false,
      icon:         null,
      prefix:       null,
      suffix:       null,
      maxlength:    null,
      minlength:    null,
      min:          null,
      max:          null,
      step:         null,
      rows:         4,
      hint:         '',
      error:        '',
      showStatus:   false,
      showCounter:  false,
      counterWarn:  0.8,
      // Select / MultiSelect
      options:      [],
      searchable:   true,
      emptyLabel:   '— Aucun —',
      maxSelect:    null,
      selectAll:    true,
      tagRemovable: true,
      // Date / Time
      weekStart:    1,
      showSeconds:  false,
      minDate:      null,
      maxDate:      null,
      // Dimensionnement du wrapper
      width:        null,
      minWidth:     null,
      maxWidth:     null,
      // Callbacks
      onChange:     null,
      onFocus:      null,
      onBlur:       null,
      onValidate:   null,
    };

    this.opts        = Object.assign({}, defaults, options);
    this._value      = this.opts.type === 'multiselect' ? [] : (this.opts.value || '');
    this._pickerDate = null;
    this._viewMode   = 'days';
    this._open       = false;
    this._portalEl   = null;

    this._source = typeof element === 'string' ? document.querySelector(element) : element;
    if (this._source) this._readFromSource();

    this.wrapper = this._buildWrapper();
    if (this._source) this._source.replaceWith(this.wrapper);

    this._bindEvents();
    this._applyDotColors(this.wrapper);
    this._measurePrefix();
    this._applyDimensions();

    // Registre global : permet à script.js de retrouver l'instance par id
    if (this.opts.id) {
      if (!window._IC_instances) window._IC_instances = {};
      window._IC_instances[this.opts.id] = this;
    }

    // Valeur initiale
    if (this.opts.type === 'multiselect' && Array.isArray(this.opts.value) && this.opts.value.length) {
      this._value = [...this.opts.value];
      this._refreshMultiDisplay();
    } else if (this.opts.type !== 'multiselect') {
      this._syncValue(this._value, false);
    }
  }

  /* ── Lecture HTML source ───────────────────────────────────── */
  _readFromSource() {
    const s = this._source, tag = s.tagName.toLowerCase();
    if (!this.opts.name && s.name)  this.opts.name = s.name;
    if (!this.opts.id   && s.id)    this.opts.id   = s.id;
    if (s.value)                    this._value    = s.value;
    if (s.disabled)  this.opts.disabled  = true;
    if (s.readOnly)  this.opts.readonly  = true;
    if (s.required)  this.opts.required  = true;
    if (s.maxLength > 0) this.opts.maxlength = s.maxLength;
    if (s.min)       this.opts.min = s.min;
    if (s.placeholder) this.opts.placeholder = s.placeholder;
    if (tag === 'textarea') { this.opts.type = 'textarea'; }
    else if (tag === 'select') {
      this.opts.type = s.multiple ? 'multiselect' : 'select';
      if (!this.opts.options.length)
        this.opts.options = Array.from(s.options).map(o => ({ value:o.value, label:o.text, disabled:o.disabled }));
    } else {
      const t = (s.getAttribute('type') || 'text').toLowerCase();
      this.opts.type = t === 'datetime-local' ? 'datetime' : t;
    }
    for (const [k,v] of Object.entries(s.dataset)) {
      if (k in this.opts) {
        const cur = this.opts[k];
        if      (typeof cur === 'boolean') this.opts[k] = v === 'true';
        else if (typeof cur === 'number')  this.opts[k] = Number(v);
        else                               this.opts[k] = v;
      }
    }
  }

  /* ══════════════════════════════════════════════════════════
     BUILD DOM
  ══════════════════════════════════════════════════════════ */
  _buildWrapper() {
    const w   = document.createElement('div');
    w.className = this._wrapCls();
    if (this.opts.id) w.dataset.inputId = this.opts.id;
    w.innerHTML = this._buildInner();
    return w;
  }

  _wrapCls() {
    const t = this.opts.type;
    const c = ['ic-wrapper', `ic-${this.opts.size}`];
    if (t === 'textarea') c.push('ic-textarea-wrap');
    if (this.opts.disabled) c.push('ic-disabled');
    if (this.opts.readonly) c.push('ic-readonly');
    if (this.opts.icon)     c.push('ic-has-icon-left');
    if (this.opts.showPassword || this.opts.clearable || this.opts.showStatus) c.push('ic-has-actions');
    if (this.opts.clearable) c.push('ic-has-clear');
    if (this.opts.prefix)    c.push('ic-has-prefix');
    if (this.opts.suffix)    c.push('ic-has-suffix');
    return c.join(' ');
  }

  _buildInner() {
    const t     = this.opts.type;
    const label = this._mkLabel();
    const acts  = this._mkActions();
    const iconL = this.opts.icon ? `<span class="ic-icon-left">${this._resolveIcon(this.opts.icon)}</span>` : '';
    let field;
    if      (t === 'select')       field = this._fieldSelect(label, iconL);
    else if (t === 'multiselect')  field = this._fieldMulti(label, iconL);
    else if (['date','time','datetime'].includes(t)) field = this._fieldPicker(label, iconL);
    else if (t === 'textarea')     field = this._fieldTextarea(label, acts, iconL);
    else                           field = this._fieldInput(label, acts, iconL);
    return field + this._mkFooter();
  }

  _mkLabel() {
    if (!this.opts.label) return '';
    const req = this.opts.required ? `<span class="ic-required">*</span>` : '';
    return `<span class="ic-label">${this.opts.label}${req}</span>`;
  }

  _mkActions() {
    let h = '';
    if (this.opts.showStatus) h += `<span class="ic-status-icon" aria-hidden="true"><span class="ic-success-icon">${IC_SVG.checkCircle}</span><span class="ic-error-icon">${IC_SVG.alertCircle}</span></span>`;
    if (this.opts.clearable)  h += `<button type="button" class="ic-btn-action ic-btn-clear" aria-label="Effacer">${IC_SVG.close}</button>`;
    if (this.opts.showPassword && this.opts.type==='password')
      h += `<button type="button" class="ic-btn-action ic-btn-eye" aria-label="Afficher le mot de passe" aria-pressed="false"><span class="ic-eye-on">${IC_SVG.eye}</span><span class="ic-eye-off">${IC_SVG.eyeOff}</span></button>`;
    return h ? `<div class="ic-actions">${h}</div>` : '';
  }

  _fieldInput(label, acts, iconL) {
    const o = this.opts;
    const typeMap = { password:'password', email:'email', tel:'tel', number:'number' };
    const t = typeMap[o.type] || 'text';
    const prefix = o.prefix ? `<span class="ic-prefix">${o.prefix}</span>` : '';
    const suffix = o.suffix ? `<span class="ic-suffix">${o.suffix}</span>` : '';
    return `<div class="ic-field">
      ${prefix}${iconL}${label}
      <input class="ic-input" type="${t}"
        ${o.id   ? `id="${o.id}"`   : ''} ${o.name ? `name="${o.name}"` : ''}
        autocomplete="${o.autocomplete}"
        ${o.required?'required':''} ${o.disabled?'disabled':''} ${o.readonly?'readonly':''}
        ${o.maxlength!=null?`maxlength="${o.maxlength}"`:''} ${o.min!=null?`min="${o.min}"`:''} ${o.max!=null?`max="${o.max}"`:''} ${o.step!=null?`step="${o.step}"`:''}>
      ${acts}${suffix}
    </div>`;
  }

  _fieldTextarea(label, acts, iconL) {
    const o = this.opts;
    return `<div class="ic-field">
      ${iconL}${label}
      <textarea class="ic-input ic-textarea"
        ${o.id?`id="${o.id}"`:''} ${o.name?`name="${o.name}"`:''} rows="${o.rows}"
        ${o.required?'required':''} ${o.disabled?'disabled':''} ${o.readonly?'readonly':''}
        ${o.maxlength!=null?`maxlength="${o.maxlength}"`:''} placeholder="${o.placeholder}"></textarea>
      ${acts}
    </div>`;
  }

  _fieldSelect(label, iconL) {
    const o = this.opts;
    return `<div class="ic-field ic-select-anchor" role="combobox" aria-haspopup="listbox" aria-expanded="false" tabindex="${o.disabled?-1:0}">
      ${iconL}${label}
      <div class="ic-select-display ic-placeholder-shown"><span class="ic-select-value"></span></div>
      <span class="ic-select-chevron" aria-hidden="true">${IC_SVG.chevronDown}</span>
      <input type="hidden" id="${o.id||''}" name="${o.name||''}" value="">
    </div>`;
  }

  _fieldMulti(label, iconL) {
    const o = this.opts;
    return `<div class="ic-field ic-select-anchor ic-multiselect-field" role="combobox" aria-haspopup="listbox" aria-multiselectable="true" aria-expanded="false" tabindex="${o.disabled?-1:0}">
      ${iconL}${label}
      <div class="ic-multi-display">
        <div class="ic-multi-tags"></div>
        <span class="ic-placeholder-text">${o.placeholder||''}</span>
      </div>
      <span class="ic-select-chevron" aria-hidden="true">${IC_SVG.chevronDown}</span>
    </div>`;
  }

  _fieldPicker(label, iconL) {
    const o = this.opts;
    const icon = o.type==='time' ? IC_SVG.clock : IC_SVG.calendar;
    return `<div class="ic-field ic-picker-anchor" tabindex="${o.disabled?-1:0}">
      ${iconL}${label}
      <div class="ic-picker-display ic-placeholder-shown"><span class="ic-picker-value"></span></div>
      <span class="ic-picker-cal-icon" aria-hidden="true">${icon}</span>
      <input type="hidden" id="${o.id||''}" name="${o.name||''}" value="">
    </div>`;
  }

  _mkFooter() {
    const o = this.opts;
    if (!o.hint && !o.error && !o.showCounter) return '';
    const counter = o.showCounter ? `<span class="ic-counter"></span>` : '';
    return `<div class="ic-footer"><span class="ic-hint">${o.hint||''}</span><span class="ic-error-msg">${o.error||''}</span>${counter}</div>`;
  }

  /* ══════════════════════════════════════════════════════════
     DROPDOWN BUILDERS (HTML → portal)
  ══════════════════════════════════════════════════════════ */
  _mkSelectDrop() {
    const o = this.opts;
    const search = o.searchable ? `<div class="ic-drop-search-wrap"><input type="text" class="ic-drop-search" placeholder="Rechercher…" autocomplete="off"></div>` : '';
    const rows   = [{ value:'', label:o.emptyLabel }, ...o.options].map(opt => {
      const dot = opt.color ? `<span class="ic-option-dot" data-color="${opt.color}"></span>` : '';
      const ic  = opt.icon  ? `<span class="ic-opt-icon">${this._resolveIcon(opt.icon)}</span>` : '';
      return `<div class="ic-select-option${opt.disabled?' ic-disabled':''}" data-value="${opt.value||''}" role="option" tabindex="-1">
        <span class="ic-opt-check">${IC_SVG.check}</span>${dot}${ic}
        <span class="ic-opt-label">${opt.label}</span>
      </div>`;
    }).join('');
    return `<div class="ic-portal-drop ic-select-dropdown" role="listbox">${search}<div class="ic-select-options">${rows}</div></div>`;
  }

  _mkMultiDrop() {
    const o = this.opts;
    const search = o.searchable ? `<div class="ic-drop-search-wrap"><input type="text" class="ic-drop-search" placeholder="Rechercher…" autocomplete="off"></div>` : '';
    const allBtn = o.selectAll  ? `<div class="ic-select-option ic-select-all-opt" role="option" tabindex="-1"><span class="ic-opt-check">${IC_SVG.check}</span><span class="ic-opt-label ic-text-muted">Tout sélectionner</span></div><div class="ic-drop-divider"></div>` : '';
    const rows   = o.options.map(opt => {
      const dot = opt.color ? `<span class="ic-option-dot" data-color="${opt.color}"></span>` : '';
      const ic  = opt.icon  ? `<span class="ic-opt-icon">${this._resolveIcon(opt.icon)}</span>` : '';
      return `<div class="ic-select-option${opt.disabled?' ic-disabled':''}" data-value="${opt.value}" role="option" tabindex="-1">
        <span class="ic-opt-check">${IC_SVG.check}</span>${dot}${ic}
        <span class="ic-opt-label">${opt.label}</span>
      </div>`;
    }).join('');
    return `<div class="ic-portal-drop ic-select-dropdown ic-multiselect-dropdown" role="listbox">
      ${search}<div class="ic-select-options">${allBtn}${rows}</div>
      <div class="ic-drop-footer"><span class="ic-multi-count"></span><button type="button" class="ic-drop-btn-ok">OK</button></div>
    </div>`;
  }

  _mkPickerDrop() {
    const t = this.opts.type;
    let h = '';
    if (t==='date'||t==='datetime') h += this._mkCal();
    if (t==='datetime')             h += `<div class="ic-datetime-sep"></div>`;
    if (t==='time'||t==='datetime') h += this._mkTime();
    h += `<div class="ic-cal-footer">
      <button type="button" class="ic-cal-btn ic-cal-btn-clear">Effacer</button>
      <button type="button" class="ic-cal-btn ic-cal-btn-today">${t==='time'?'Maintenant':"Aujourd'hui"}</button>
      <button type="button" class="ic-cal-btn ic-cal-btn-ok">OK</button>
    </div>`;
    return `<div class="ic-portal-drop ic-picker-dropdown">${h}</div>`;
  }

  _mkCal() {
    const d    = this._pickerDate || new Date();
    const y    = d.getFullYear(), m = d.getMonth();
    const mode = this._viewMode;
    let body;
    if      (mode==='days')   body = this._calDays(y, m);
    else if (mode==='months') body = this._calMonths(y);
    else                      body = this._calYears(y);
    const title = mode==='days' ? `${FR_MONTHS_LONG[m]} ${y}` : mode==='months' ? `${y}` : `${y-5} – ${y+6}`;
    return `<div class="ic-cal-container">
      <div class="ic-cal-header">
        <button type="button" class="ic-cal-nav ic-cal-prev">${IC_SVG.chevronLeft}</button>
        <span class="ic-cal-title" tabindex="0">${title}</span>
        <button type="button" class="ic-cal-nav ic-cal-next">${IC_SVG.chevronRight}</button>
      </div>
      <div class="ic-cal-body">${body}</div>
    </div>`;
  }

  _calDays(year, mon) {
    const ws  = this.opts.weekStart;
    const ord = ws===1 ? ['Lu','Ma','Me','Je','Ve','Sa','Di'] : ['Di','Lu','Ma','Me','Je','Ve','Sa'];
    const names = ord.map(d=>`<div class="ic-cal-dayname">${d}</div>`).join('');
    const first = new Date(year, mon, 1);
    const off   = (first.getDay() - ws + 7) % 7;
    const dim   = new Date(year, mon+1, 0).getDate();
    const prev  = new Date(year, mon, 0).getDate();
    const today = new Date();
    let cells='', day=1, nxt=1;
    for (let i=0; i<42; i++) {
      if (i<off) {
        const n=prev-off+i+1, pm=mon===0?11:mon-1, py=mon===0?year-1:year;
        cells += `<div class="ic-cal-day ic-cal-other-month" data-day="${n}" data-month="${pm}" data-year="${py}">${n}</div>`;
      } else if (day<=dim) {
        const d=new Date(year,mon,day);
        let c='ic-cal-day';
        if (d.toDateString()===today.toDateString()) c+=' ic-cal-today';
        if (this._isSelDay(d)) c+=' ic-cal-selected';
        if (this._isDisDay(d)) c+=' ic-cal-disabled';
        cells += `<div class="${c}" data-day="${day}" data-month="${mon}" data-year="${year}">${day}</div>`;
        day++;
      } else {
        const nm=mon===11?0:mon+1, ny=mon===11?year+1:year;
        cells += `<div class="ic-cal-day ic-cal-other-month" data-day="${nxt}" data-month="${nm}" data-year="${ny}">${nxt++}</div>`;
      }
    }
    return `<div class="ic-cal-daynames">${names}</div><div class="ic-cal-days">${cells}</div>`;
  }

  _calMonths(year) {
    return `<div class="ic-cal-months">${FR_MONTHS_SHORT.map((m,i)=>{
      const sel=this._pickerDate&&this._pickerDate.getFullYear()===year&&this._pickerDate.getMonth()===i;
      return `<div class="ic-cal-month-cell${sel?' ic-selected':''}" data-month="${i}" data-year="${year}">${m}</div>`;
    }).join('')}</div>`;
  }

  _calYears(base) {
    const s=base-5; let h='';
    for (let y=s; y<=s+11; y++) {
      const sel=this._pickerDate&&this._pickerDate.getFullYear()===y;
      h += `<div class="ic-cal-year-cell${sel?' ic-selected':''}" data-year="${y}">${y}</div>`;
    }
    return `<div class="ic-cal-years">${h}</div>`;
  }

  _mkTime() {
    const d=this._pickerDate;
    const h=d?String(d.getHours()).padStart(2,'0'):'00';
    const m=d?String(d.getMinutes()).padStart(2,'0'):'00';
    const s=d?String(d.getSeconds()).padStart(2,'0'):'00';
    const ss=this.opts.showSeconds;
    const col=(val,cls,lbl)=>`<div class="ic-time-col">
      <button type="button" class="ic-time-nav ${cls}-up">${IC_SVG.chevronUp}</button>
      <input type="number" class="ic-time-val ${cls}" value="${val}" min="0" aria-label="${lbl}">
      <button type="button" class="ic-time-nav ${cls}-down">${IC_SVG.chevronDown}</button>
    </div>`;
    return `<div class="ic-time-container">
      <div class="ic-time-label-row">
        <span class="ic-time-label">Heure</span><span class="ic-time-sep-spacer"></span>
        <span class="ic-time-label">Minute</span>
        ${ss?'<span class="ic-time-sep-spacer"></span><span class="ic-time-label">Sec.</span>':''}
      </div>
      <div class="ic-time-picker">
        ${col(h,'ic-time-h','heure')}<span class="ic-time-sep">:</span>
        ${col(m,'ic-time-m','minute')}
        ${ss?`<span class="ic-time-sep">:</span>${col(s,'ic-time-s','seconde')}`:''}
      </div>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     EVENTS
  ══════════════════════════════════════════════════════════ */
  _bindEvents() {
    const t = this.opts.type;
    if      (t==='select')      this._bindSelect();
    else if (t==='multiselect') this._bindMulti();
    else if (['date','time','datetime'].includes(t)) this._bindPicker();
    else                        this._bindInput();

    this._onOutside = (e) => {
      if (!this.wrapper.contains(e.target) && this._portalEl && !this._portalEl.contains(e.target))
        this._closePortal();
    };
    document.addEventListener('mousedown', this._onOutside);
  }

  _bindInput() {
    const w=this.wrapper, inp=w.querySelector('.ic-input');
    if (!inp) return;
    inp.addEventListener('focus', ()=>{ w.classList.add('ic-focused'); if(this.opts.onFocus) this.opts.onFocus(this._value); });
    inp.addEventListener('blur',  ()=>{ w.classList.remove('ic-focused'); this._validate(); if(this.opts.onBlur) this.opts.onBlur(this._value); });
    inp.addEventListener('input', ()=>{ this._value=inp.value; this._updateHasValue(); this._updateCounter(); if(this.opts.onChange) this.opts.onChange(this._value); });
    const eye=w.querySelector('.ic-btn-eye');
    if (eye) {
      eye.addEventListener('click',()=>{
        const v=inp.type==='password'; inp.type=v?'text':'password';
        eye.classList.toggle('is-visible',v);
        eye.setAttribute('aria-pressed',String(v));
        eye.setAttribute('aria-label',v?'Masquer':'Afficher le mot de passe');
        inp.focus();
      });
    }
    const clr=w.querySelector('.ic-btn-clear');
    if (clr) clr.addEventListener('click',()=>{ this.setValue(''); inp.focus(); });
  }

  /* ── Select (single) ─────────────────────────────────────── */
  _bindSelect() {
    const w=this.wrapper, anchor=w.querySelector('.ic-select-anchor');
    anchor.addEventListener('click',  ()=>this._open?this._closePortal():this._openSelect());
    anchor.addEventListener('keydown', e=>{ if([' ','Enter'].includes(e.key)){e.preventDefault();this._open?this._closePortal():this._openSelect();} if(e.key==='Escape')this._closePortal(); });
  }

  _openSelect() {
    if (this._open||this.opts.disabled) return;
    this._open=true;
    const anchor = this.wrapper.querySelector('.ic-select-anchor');
    const drop   = this._htmlToDom(this._mkSelectDrop());
    this._portalEl = drop;
    IC_Portal.attach(drop, anchor, null);
    this._applyDotColors(drop);
    this._markSelected(drop, this._value);
    this.wrapper.classList.add('ic-focused','ic-select-open');
    anchor.setAttribute('aria-expanded','true');

    const search=drop.querySelector('.ic-drop-search');
    if (search) {
      setTimeout(()=>search.focus(), 30);
      search.addEventListener('input',()=>this._filterOpts(drop, search.value));
      search.addEventListener('keydown',e=>{ if(e.key==='Escape')this._closePortal(); if(e.key==='Tab')this._closePortal(); });
    }
    drop.querySelectorAll('.ic-select-option').forEach(opt=>{
      opt.addEventListener('click',()=>{ if(opt.classList.contains('ic-disabled'))return; this._selectSingle(opt.dataset.value); this._closePortal(); });
      opt.addEventListener('keydown',e=>{ if([' ','Enter'].includes(e.key)){e.preventDefault();opt.click();} if(e.key==='Escape')this._closePortal(); });
    });
  }

  _selectSingle(val) {
    const w=this.wrapper, disp=w.querySelector('.ic-select-display'), hid=w.querySelector('input[type="hidden"]');
    const found=this.opts.options.find(o=>String(o.value)===String(val));
    this._value=val;
    if (!val||!found) {
      disp.innerHTML='<span class="ic-select-value"></span>';
      disp.classList.add('ic-placeholder-shown');
      if(hid) hid.value='';
    } else {
      const dot=found.color?`<span class="ic-option-dot" data-color="${found.color}"></span>`:'';
      disp.innerHTML=`${dot}<span class="ic-select-value">${found.label}</span>`;
      if(found.color){ const de=disp.querySelector('.ic-option-dot'); if(de) de.style.setProperty('--ic-dot-color',found.color); }
      disp.classList.remove('ic-placeholder-shown');
      if(hid) hid.value=val;
    }
    this._updateHasValue();
    if(this.opts.onChange) this.opts.onChange(this._value);
  }

  _markSelected(drop, val) {
    drop.querySelectorAll('.ic-select-option').forEach(o=>o.classList.toggle('ic-selected', String(o.dataset.value)===String(val)));
  }

  /* ── MultiSelect ─────────────────────────────────────────── */
  _bindMulti() {
    const w=this.wrapper, anchor=w.querySelector('.ic-select-anchor');
    anchor.addEventListener('click', e=>{ if(e.target.closest('.ic-tag-remove'))return; this._open?this._closePortal():this._openMulti(); });
    anchor.addEventListener('keydown', e=>{ if([' ','Enter'].includes(e.key)){e.preventDefault();this._open?this._closePortal():this._openMulti();} if(e.key==='Escape')this._closePortal(); });
    w.addEventListener('click', e=>{ const r=e.target.closest('.ic-tag-remove'); if(!r)return; const v=r.dataset.value; this._value=this._value.filter(x=>x!==v); this._refreshMultiDisplay(); if(this.opts.onChange)this.opts.onChange([...this._value]); });
  }

  _openMulti() {
    if (this._open||this.opts.disabled) return;
    this._open=true;
    const anchor=this.wrapper.querySelector('.ic-select-anchor');
    const drop=this._htmlToDom(this._mkMultiDrop());
    this._portalEl=drop;
    IC_Portal.attach(drop, anchor, null);
    this._applyDotColors(drop);
    this._markMulti(drop);
    this._updateMultiCount(drop);
    this.wrapper.classList.add('ic-focused','ic-select-open');
    anchor.setAttribute('aria-expanded','true');

    const search=drop.querySelector('.ic-drop-search');
    if (search) {
      setTimeout(()=>search.focus(),30);
      search.addEventListener('input',()=>{ this._filterOpts(drop,search.value); this._markMulti(drop); });
    }

    const allBtn=drop.querySelector('.ic-select-all-opt');
    if (allBtn) {
      allBtn.addEventListener('click',()=>{
        const vis=Array.from(drop.querySelectorAll('.ic-select-option:not(.ic-select-all-opt):not(.ic-hidden):not(.ic-disabled)'));
        const allSel=vis.every(o=>this._value.includes(o.dataset.value));
        if (allSel) { this._value=[]; }
        else { vis.forEach(o=>{ if(!this._value.includes(o.dataset.value)) this._value.push(o.dataset.value); }); }
        this._markMulti(drop); this._updateMultiCount(drop); this._refreshMultiDisplay();
        if(this.opts.onChange) this.opts.onChange([...this._value]);
      });
    }

    drop.querySelectorAll('.ic-select-option:not(.ic-select-all-opt)').forEach(opt=>{
      opt.addEventListener('click',()=>{
        if(opt.classList.contains('ic-disabled'))return;
        const v=opt.dataset.value, idx=this._value.indexOf(v);
        if (idx>-1) this._value.splice(idx,1);
        else { if(this.opts.maxSelect&&this._value.length>=this.opts.maxSelect)return; this._value.push(v); }
        this._markMulti(drop); this._updateMultiCount(drop); this._refreshMultiDisplay();
        if(this.opts.onChange) this.opts.onChange([...this._value]);
      });
    });

    drop.querySelector('.ic-drop-btn-ok').addEventListener('click',()=>this._closePortal());
  }

  _markMulti(drop) {
    drop.querySelectorAll('.ic-select-option:not(.ic-select-all-opt)').forEach(o=>o.classList.toggle('ic-selected',this._value.includes(o.dataset.value)));
    const all=drop.querySelector('.ic-select-all-opt');
    if (all) {
      const vis=Array.from(drop.querySelectorAll('.ic-select-option:not(.ic-select-all-opt):not(.ic-hidden):not(.ic-disabled)'));
      all.classList.toggle('ic-selected', vis.length>0&&vis.every(o=>this._value.includes(o.dataset.value)));
    }
  }

  _updateMultiCount(drop) {
    const c=drop.querySelector('.ic-multi-count');
    if(c) c.textContent=this._value.length?`${this._value.length} sélectionné${this._value.length>1?'s':''}` : '';
  }

  _refreshMultiDisplay() {
    const tags=this.wrapper.querySelector('.ic-multi-tags'), ph=this.wrapper.querySelector('.ic-placeholder-text');
    if(!tags) return;
    if(!this._value.length){ tags.innerHTML=''; if(ph) ph.classList.remove('ic-hidden'); this.wrapper.classList.remove('ic-has-value'); return; }
    if(ph) ph.classList.add('ic-hidden');
    this.wrapper.classList.add('ic-has-value');
    tags.innerHTML=this._value.map(val=>{
      const opt=this.opts.options.find(o=>String(o.value)===String(val)); if(!opt) return '';
      const dot=opt.color?`<span class="ic-tag-dot" data-color="${opt.color}"></span>`:'';
      const rmv=this.opts.tagRemovable?`<button type="button" class="ic-tag-remove" data-value="${val}">${IC_SVG.close}</button>`:'';
      return `<span class="ic-tag">${dot}<span class="ic-tag-label">${opt.label}</span>${rmv}</span>`;
    }).join('');
    tags.querySelectorAll('[data-color]').forEach(el=>el.style.setProperty('--ic-dot-color',el.dataset.color));
  }

  _filterOpts(drop, q) {
    drop.querySelectorAll('.ic-select-option:not(.ic-select-all-opt)').forEach(opt=>{
      const t=opt.querySelector('.ic-opt-label').textContent.toLowerCase();
      opt.classList.toggle('ic-hidden', !t.includes(q.toLowerCase()));
    });
  }

  /* ── Picker ───────────────────────────────────────────────── */
  _bindPicker() {
    const anchor=this.wrapper.querySelector('.ic-picker-anchor');
    anchor.addEventListener('click',  ()=>this._open?this._closePortal():this._openPicker());
    anchor.addEventListener('keydown', e=>{ if([' ','Enter'].includes(e.key)){e.preventDefault();this._openPicker();} if(e.key==='Escape')this._closePortal(); });
  }

  _openPicker() {
    if(this._open||this.opts.disabled) return;
    this._open=true;
    if(!this._pickerDate) this._pickerDate=new Date();
    this._viewMode='days';
    const anchor=this.wrapper.querySelector('.ic-picker-anchor');
    const drop=this._htmlToDom(this._mkPickerDrop());
    this._portalEl=drop;
    IC_Portal.attach(drop, anchor, '300px');
    this.wrapper.classList.add('ic-focused','ic-picker-open');
    this._bindPickerDrop(drop);
  }

  _bindPickerDrop(drop) {
    const close=()=>this._closePortal();
    const rerender=()=>{
      drop.innerHTML=this._htmlToDom(this._mkPickerDrop()).innerHTML;
      this._bindPickerDrop(drop);
      IC_Portal.reposition(drop);
    };

    drop.addEventListener('click', e=>{
      const t=e.target;
      if(t.closest('.ic-cal-prev')){ this._calNav(-1); rerender(); return; }
      if(t.closest('.ic-cal-next')){ this._calNav(+1); rerender(); return; }
      if(t.closest('.ic-cal-title')){ this._viewMode=this._viewMode==='days'?'months':this._viewMode==='months'?'years':'days'; rerender(); return; }

      const day=t.closest('.ic-cal-day:not(.ic-cal-disabled)');
      if(day&&!day.classList.contains('ic-cal-other-month')||day&&day.dataset.year){
        if(!this._pickerDate) this._pickerDate=new Date();
        this._pickerDate.setFullYear(+day.dataset.year,+day.dataset.month,+day.dataset.day);
        this._viewMode='days';
        rerender();
        if(this.opts.type==='date'){this._confirmPicker();close();}
        return;
      }

      const mon=t.closest('.ic-cal-month-cell');
      if(mon){ if(!this._pickerDate) this._pickerDate=new Date(); this._pickerDate.setMonth(+mon.dataset.month); this._viewMode='days'; rerender(); return; }

      const yr=t.closest('.ic-cal-year-cell');
      if(yr){ if(!this._pickerDate) this._pickerDate=new Date(); this._pickerDate.setFullYear(+yr.dataset.year); this._viewMode='months'; rerender(); return; }

      const tnav=t.closest('.ic-time-nav');
      if(tnav){
        if(!this._pickerDate) this._pickerDate=new Date();
        const up=tnav.className.includes('-up'), d=up?1:-1;
        if(tnav.className.includes('ic-time-h')) this._pickerDate.setHours((this._pickerDate.getHours()+d+24)%24);
        else if(tnav.className.includes('ic-time-m')) this._pickerDate.setMinutes((this._pickerDate.getMinutes()+d+60)%60);
        else this._pickerDate.setSeconds((this._pickerDate.getSeconds()+d+60)%60);
        rerender(); return;
      }

      if(t.closest('.ic-cal-btn-ok'))    { this._confirmPicker(); close(); return; }
      if(t.closest('.ic-cal-btn-today')) { this._pickerDate=new Date(); this._viewMode='days'; rerender(); return; }
      if(t.closest('.ic-cal-btn-clear')) { this._pickerDate=null; this.setValue(''); close(); return; }
    });

    drop.addEventListener('change', e=>{
      const t=e.target; if(!t.classList.contains('ic-time-val'))return;
      if(!this._pickerDate) this._pickerDate=new Date();
      const v=Math.max(0,parseInt(t.value)||0);
      if(t.classList.contains('ic-time-h')) this._pickerDate.setHours(Math.min(23,v));
      else if(t.classList.contains('ic-time-m')) this._pickerDate.setMinutes(Math.min(59,v));
      else this._pickerDate.setSeconds(Math.min(59,v));
      rerender();
    });
  }

  _calNav(d) {
    if(!this._pickerDate) this._pickerDate=new Date();
    if(this._viewMode==='days')   this._pickerDate.setMonth(this._pickerDate.getMonth()+d);
    else if(this._viewMode==='months') this._pickerDate.setFullYear(this._pickerDate.getFullYear()+d);
    else this._pickerDate.setFullYear(this._pickerDate.getFullYear()+d*12);
  }

  _confirmPicker() {
    if(!this._pickerDate) return;
    const t=this.opts.type;
    const sep = this.opts.isoFormat ? 'T' : ' ';
    let val = t==='date' ? this._fmtD(this._pickerDate) : t==='time' ? this._fmtT(this._pickerDate) : `${this._fmtD(this._pickerDate)}${sep}${this._fmtT(this._pickerDate)}`;
    this.setValue(val);
  }

  _fmtD(d){
    if (this.opts.isoFormat) {
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }
  _fmtT(d){
    const h=String(d.getHours()).padStart(2,'0'), m=String(d.getMinutes()).padStart(2,'0');
    const base = this.opts.showSeconds ? `${h}:${m}:${String(d.getSeconds()).padStart(2,'0')}` : `${h}:${m}`;
    return base;
  }
  _isSelDay(d){ return this._pickerDate&&d.toDateString()===this._pickerDate.toDateString(); }
  _isDisDay(d){
    if(this.opts.minDate&&d<new Date(this.opts.minDate))return true;
    if(this.opts.maxDate&&d>new Date(this.opts.maxDate))return true;
    return false;
  }

  /* ── Portal helpers ──────────────────────────────────────── */
  _htmlToDom(html) {
    const tmp=document.createElement('div'); tmp.innerHTML=html.trim(); return tmp.firstElementChild;
  }

  _closePortal() {
    if(this._portalEl){ IC_Portal.detach(this._portalEl); this._portalEl=null; }
    this._open=false;
    this.wrapper.classList.remove('ic-focused','ic-select-open','ic-picker-open');
    const a=this.wrapper.querySelector('[aria-expanded]'); if(a) a.setAttribute('aria-expanded','false');
  }

  /* ── Helpers ─────────────────────────────────────────────── */
  _validate() {
    const v=this._value; let err='';
    const len=String(v||'').length;
    if(this.opts.required&&!v&&!this._value.length) err='Ce champ est obligatoire.';
    else if(this.opts.minlength&&len<this.opts.minlength) err=`Minimum ${this.opts.minlength} caractères.`;
    else if(this.opts.maxlength&&len>this.opts.maxlength) err=`Maximum ${this.opts.maxlength} caractères.`;
    else if(this.opts.type==='email'&&v&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) err='Adresse email invalide.';
    else if(this.opts.onValidate){ const r=this.opts.onValidate(v); if(r!==true) err=r||'Valeur invalide.'; }
    this.setError(err);
    if(!err&&v) this.wrapper.classList.add('ic-has-success'); else this.wrapper.classList.remove('ic-has-success');
    if(err){ this.wrapper.classList.add('ic-shake'); this.wrapper.addEventListener('animationend',()=>this.wrapper.classList.remove('ic-shake'),{once:true}); }
    return !err;
  }

  _syncValue(val, fire=true) {
    const t=this.opts.type;
    this._value=val;
    if(['date','time','datetime'].includes(t)){
      const disp=this.wrapper.querySelector('.ic-picker-display'), hid=this.wrapper.querySelector('input[type="hidden"]');
      if(disp){ disp.querySelector('.ic-picker-value').textContent=val||''; disp.classList.toggle('ic-placeholder-shown',!val); }
      if(hid) hid.value=val;
    } else if(t!=='select'&&t!=='multiselect') {
      const inp=this.wrapper.querySelector('.ic-input'); if(inp&&inp.value!==val) inp.value=val;
    }
    this._updateHasValue();
    this._updateCounter();
    if(fire&&this.opts.onChange) this.opts.onChange(val);
  }

  _updateHasValue() {
    const has=Array.isArray(this._value)?this._value.length>0:!!this._value;
    this.wrapper.classList.toggle('ic-has-value',has);
  }

  _updateCounter() {
    const c=this.wrapper.querySelector('.ic-counter'); if(!c||!this.opts.maxlength)return;
    const len=String(this._value||'').length, max=this.opts.maxlength;
    c.textContent=`${len}/${max}`;
    this.wrapper.classList.toggle('ic-counter-near',len/max>=this.opts.counterWarn&&len<max);
    this.wrapper.classList.toggle('ic-counter-over',len>max);
  }

  _applyDotColors(root) {
    (root||this.wrapper).querySelectorAll('[data-color]').forEach(el=>el.style.setProperty('--ic-dot-color',el.dataset.color));
  }

  /* Mesure la largeur réelle du préfixe après rendu et l'expose
     en custom property pour que le label flottant se positionne correctement */
  _measurePrefix() {
    if (!this.opts.prefix) return;
    const prefixEl = this.wrapper.querySelector('.ic-prefix');
    if (!prefixEl) return;
    requestAnimationFrame(() => {
      const w = prefixEl.getBoundingClientRect().width;
      this.wrapper.style.setProperty('--ic-prefix-w', w + 'px');
    });
  }

  _applyDimensions() {
    const { width, minWidth, maxWidth } = this.opts;
    if (width)    { this.wrapper.style.setProperty('--ic-max-w', width);     this.wrapper.style.width    = width; }
    if (minWidth) { this.wrapper.style.minWidth = minWidth; }
    if (maxWidth) { this.wrapper.style.setProperty('--ic-max-w', maxWidth);  this.wrapper.style.maxWidth = maxWidth; }
  }

  _resolveIcon(icon) { return IC_SVG[icon]||icon||''; }

  /* ══════════════════════════════════════════════════════════
     API PUBLIQUE
  ══════════════════════════════════════════════════════════ */
  setValue(val) {
    if(this.opts.type==='select'){ this._selectSingle(val); return; }
    if(this.opts.type==='multiselect'){ this._value=Array.isArray(val)?[...val]:[]; this._refreshMultiDisplay(); return; }
    this._syncValue(val);
  }
  getValue()  { return this._value; }
  setError(msg) {
    this.wrapper.classList.toggle('ic-has-error',!!msg);
    if(!!msg) this.wrapper.classList.remove('ic-has-success');
    const e=this.wrapper.querySelector('.ic-error-msg'); if(e) e.textContent=msg||'';
  }
  setHint(msg){ const e=this.wrapper.querySelector('.ic-hint'); if(e) e.textContent=msg; }
  enable()    { this.opts.disabled=false; this.wrapper.classList.remove('ic-disabled'); }
  disable()   { this.opts.disabled=true;  this.wrapper.classList.add('ic-disabled'); }
  validate()  { return this._validate(); }
  destroy()   { this._closePortal(); document.removeEventListener('mousedown',this._onOutside); this.wrapper.remove(); }

  /* ── Compatibilité API Select_Comp / MultiSelect ────────────
     Permet de remplacer new MultiSelect(…) par new InputComp(…)
     sans modifier les appels existants dans script.js
  ─────────────────────────────────────────────────────────── */

  /** [{value, text}] — équivalent de MultiSelect.selectedItems */
  get selectedItems() {
    if (this.opts.type !== 'multiselect') {
      const found = this.opts.options.find(o => String(o.value) === String(this._value));
      return found ? [{ value: String(found.value), text: found.label }] : [];
    }
    return this._value.map(v => {
      const opt = this.opts.options.find(o => String(o.value) === String(v));
      return opt ? { value: String(opt.value), text: opt.label } : { value: String(v), text: v };
    });
  }

  /** [value, …] — équivalent de MultiSelect.selectedValues */
  get selectedValues() {
    if (this.opts.type !== 'multiselect') return this._value ? [String(this._value)] : [];
    return [...this._value];
  }

  /** Sélectionne une valeur (multiselect ou select) */
  select(val) {
    const v = String(val);
    if (this.opts.type === 'multiselect') {
      if (!this._value.includes(v)) {
        this._value.push(v);
        this._refreshMultiDisplay();
        if (this.opts.onChange) this.opts.onChange([...this._value]);
      }
    } else {
      this._selectSingle(v);
    }
  }

  /** Désélectionne une valeur (multiselect) */
  unselect(val) {
    const v = String(val);
    if (this.opts.type === 'multiselect') {
      this._value = this._value.filter(x => x !== v);
      this._refreshMultiDisplay();
      if (this.opts.onChange) this.opts.onChange([...this._value]);
    } else if (String(this._value) === v) {
      this._selectSingle('');
    }
  }

  /** Ajoute dynamiquement des options (ex : chargement asynchrone) */
  addItems(items) {
    this.opts.options.push(...items);
  }

  /** Remplace toutes les options */
  setOptions(items) {
    this.opts.options = [...items];
  }

  /** Réinitialise toutes les sélections */
  clearSelection() {
    if (this.opts.type === 'multiselect') {
      this._value = [];
      this._refreshMultiDisplay();
    } else {
      this._selectSingle('');
    }
  }
}

/* ── Auto-init ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-input-comp]').forEach(el => {
    let opts={};
    try{ if(el.dataset.inputComp) opts=JSON.parse(el.dataset.inputComp); }catch(e){}
    new InputComp(el, opts);
  });
});
