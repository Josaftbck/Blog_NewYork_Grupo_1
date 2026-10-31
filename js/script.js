/* Maqueta NYC Systems: navegación, filtros, pestañas y simulador de una instrucción */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ------------------------------------------------------------------
     Navegación
  ------------------------------------------------------------------ */
  const nav = $('#nav');
  const toggle = $('.nav-toggle');

  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  });

  $$('a', nav).forEach(a => a.addEventListener('click', () => {
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
  }));

  const navLinks = new Map($$('a', nav).map(a => [a.getAttribute('href').slice(1), a]));
  const spy = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      navLinks.forEach(a => a.classList.remove('is-current'));
      const link = navLinks.get(entry.target.id);
      if (link) link.classList.add('is-current');
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  navLinks.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });

  /* ------------------------------------------------------------------
     Filtro de componentes
  ------------------------------------------------------------------ */
  const chips = $$('.chip');
  const comps = $$('.comp');
  chips.forEach(chip => chip.addEventListener('click', () => {
    const f = chip.dataset.filter;
    chips.forEach(c => {
      const on = c === chip;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', String(on));
    });
    comps.forEach(card => card.classList.toggle('is-hidden', f !== 'all' && card.dataset.group !== f));
  }));

  /* ------------------------------------------------------------------
     Pestañas de subsistemas
  ------------------------------------------------------------------ */
  const tabs = $$('.tab');
  const panels = $$('.tabpanel');

  function selectTab(tab, focus) {
    tabs.forEach(t => {
      const on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    panels.forEach(p => {
      const on = p.id === tab.getAttribute('aria-controls');
      p.hidden = !on;
      p.classList.toggle('is-active', on);
    });
    if (focus) tab.focus();
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', e => {
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      if (e.key === 'Home') next = tabs[0];
      if (e.key === 'End') next = tabs[tabs.length - 1];
      if (next) { e.preventDefault(); selectTab(next, true); }
    });
  });

  /* ------------------------------------------------------------------
     Simulador
     Tiempos tomados del informe: consulta cada 5 s, PING cada 3 s,
     fuera de línea tras 10 s, espera de respuesta de 3.5 s, servo de
     115 a 180 grados con un grado por ciclo y pausa de 20 ms.
  ------------------------------------------------------------------ */
  const POLL_MS = 5000;
  const PING_MS = 3000;
  const OFFLINE_MS = 10000;
  const I2C_WAIT_MS = 3500;
  const SERVO_OPEN = 115;
  const SERVO_CLOSED = 180;
  const CART_MAX = 3000;
  const CART_TRAVEL_MS = 3000;
  const UART_TIMEOUT_MS = 4000;

  const ROUTES = {
    SERVO_SUBIR: 'POST /api/puente/abrir',
    SERVO_BAJAR: 'POST /api/puente/cerrar',
    TELEFERICO_AVANZAR: 'POST /api/teleferico/avanzar',
    TELEFERICO_REGRESAR: 'POST /api/teleferico/regresar'
  };

  const sim = {
    speed: 4,
    now: 0,
    busy: false,
    queue: [],
    nextId: 1,
    done: 0,
    pollLeft: POLL_MS,
    pingLeft: PING_MS,
    lastPong: 0,
    megaResponds: true,
    unoResponds: true,
    megaOnline: true,
    unoOnline: true,
    bridge: SERVO_CLOSED,
    cart: 0
  };

  const pipeline = $('#pipeline');
  if (!pipeline) return;

  const nodes = {};
  $$('.node', pipeline).forEach(n => { nodes[n.dataset.node] = n; });
  const el = {
    step: $('#simStep'),
    log: $('#log'),
    bitacora: $('#bitacora'),
    queueCount: $('#queueCount'),
    ring: $('#ring'),
    pollTime: $('#pollTime'),
    dotMega: $('#dotMega'),
    dotUno: $('#dotUno'),
    valMega: $('#valMega'),
    valUno: $('#valUno'),
    done: $('#mDone'),
    latency: $('#mLatency'),
    deck: $('#deck'),
    angle: $('#angleText'),
    cabin: $('#cabin'),
    steps: $('#stepsText'),
    lampRed: $('#lampRed'),
    lampYellow: $('#lampYellow'),
    lampGreen: $('#lampGreen'),
    lightNote: $('#lightNote'),
    speed: $('#speed'),
    mega: $('#megaResponds'),
    uno: $('#unoResponds')
  };

  const RING_LEN = 2 * Math.PI * 34;
  el.ring.style.strokeDasharray = String(RING_LEN);

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms / sim.speed));
  const fmtSeconds = ms => (ms / 1000).toFixed(1) + ' s';

  /* ---------- Registro ---------- */
  function appendLog(li) {
    el.log.appendChild(li);
    while (el.log.children.length > 120) el.log.removeChild(el.log.firstChild);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function log(message, kind) {
    const li = document.createElement('li');
    if (kind) li.className = 'k-' + kind;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = 't+' + (sim.now / 1000).toFixed(1).padStart(5, '0');
    li.append(t, document.createTextNode(message));
    appendLog(li);
  }

  function logEmptyPoll() {
    const last = el.log.lastElementChild;
    if (last && last.dataset.poll) {
      const n = Number(last.dataset.poll) + 1;
      last.dataset.poll = String(n);
      last.lastChild.textContent = `ESP32 consulta pendientes: sin instrucciones, x${n}`;
      return;
    }
    const li = document.createElement('li');
    li.className = 'k-muted';
    li.dataset.poll = '1';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = 't+' + (sim.now / 1000).toFixed(1).padStart(5, '0');
    li.append(t, document.createTextNode('ESP32 consulta pendientes: sin instrucciones, x1'));
    appendLog(li);
  }

  /* ---------- Tubería visual ---------- */
  const center = key => nodes[key].offsetLeft + nodes[key].offsetWidth / 2;

  function setActive(...keys) {
    Object.entries(nodes).forEach(([k, n]) => n.classList.toggle('is-active', keys.includes(k)));
  }

  function flash(key, cls, ms) {
    nodes[key].classList.add(cls);
    setTimeout(() => nodes[key].classList.remove(cls), ms / sim.speed);
  }

  function setStep(text) { el.step.textContent = text; }

  function makePacket(from) {
    const p = document.createElement('span');
    p.className = 'packet';
    p.style.left = center(from) + 'px';
    pipeline.appendChild(p);
    void p.offsetWidth;
    return p;
  }

  async function hop(packet, to) {
    packet.style.transitionDuration = (500 / sim.speed) + 'ms';
    packet.style.left = center(to) + 'px';
    await sleep(540);
  }

  function updateQueue() {
    el.queueCount.textContent = 'Cola: ' + sim.queue.length;
  }

  /* ---------- Maqueta ---------- */
  function renderBridge() {
    const rotation = -(SERVO_CLOSED - sim.bridge);
    el.deck.setAttribute('transform', `rotate(${rotation} 110 108)`);
    el.angle.textContent = sim.bridge + ' grados';

    const closed = sim.bridge === SERVO_CLOSED;
    const open = sim.bridge === SERVO_OPEN;
    el.lampGreen.setAttribute('class', 'lamp' + (closed ? ' on-green' : ''));
    el.lampYellow.setAttribute('class', 'lamp' + (!closed && !open ? ' on-yellow' : ''));
    el.lampRed.setAttribute('class', 'lamp' + (open ? ' on-red' : ''));
    el.lightNote.textContent = closed
      ? 'Semáforo en verde: el puente está cerrado y el tránsito avanza.'
      : open
        ? 'Semáforo en rojo: el puente está elevado y el tránsito se detiene.'
        : 'Semáforo en amarillo: el puente está en movimiento.';
  }

  function renderCart() {
    const x = 60 + (sim.cart / CART_MAX) * 260;
    el.cabin.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
    el.steps.textContent = sim.cart + ' pasos';
  }

  async function moveServo(target) {
    const dir = Math.sign(target - sim.bridge);
    while (sim.bridge !== target) {
      sim.bridge += dir;
      renderBridge();
      await sleep(20);
    }
  }

  async function moveCart(target) {
    const from = sim.cart;
    const start = sim.now;
    for (;;) {
      const f = Math.min(1, (sim.now - start) / CART_TRAVEL_MS);
      sim.cart = Math.round(from + (target - from) * f);
      renderCart();
      if (f >= 1) break;
      await sleep(33);
    }
  }

  async function actuate(cmd) {
    switch (cmd) {
      case 'SERVO_SUBIR': await moveServo(SERVO_OPEN); return 'POS:' + String(SERVO_OPEN).padStart(3, '0');
      case 'SERVO_BAJAR': await moveServo(SERVO_CLOSED); return 'POS:' + String(SERVO_CLOSED).padStart(3, '0');
      case 'TELEFERICO_AVANZAR': await moveCart(CART_MAX); return 'OK';
      case 'TELEFERICO_REGRESAR': await moveCart(0); return 'OK';
      default: return 'OK';
    }
  }

  /* ---------- Banderas ---------- */
  function renderFlags() {
    el.dotMega.classList.toggle('off', !sim.megaOnline);
    el.valMega.textContent = String(sim.megaOnline);
    el.dotUno.classList.toggle('off', !sim.unoOnline);
    el.valUno.textContent = String(sim.unoOnline);
    nodes.mega.classList.toggle('is-error', !sim.megaOnline);
  }

  function checkFlags() {
    const online = sim.now - sim.lastPong < OFFLINE_MS;
    if (online === sim.megaOnline) return;
    sim.megaOnline = online;
    if (!online) {
      sim.unoOnline = false;
      log('Pasaron 10 s sin respuesta al PING: megaOnline = false', 'err');
    } else {
      sim.unoOnline = sim.unoResponds;
      log('El Mega respondió el PING: megaOnline = true', 'ok');
    }
    renderFlags();
  }

  function onPing() {
    flash('mega', 'is-pulse', 300);
    if (sim.megaResponds) sim.lastPong = sim.now;
  }

  /* ---------- Cadena de ejecución ---------- */
  async function runChain(ins, packet) {
    await sleep(300);

    if (!sim.megaOnline) {
      log('megaOnline es false: el ESP32 no envía y reporta ERROR', 'err');
      setStep('El ESP32 sabe que el Mega está fuera de línea. No envía el comando y reportará ERROR.');
      packet.classList.add('is-error');
      return { res: 'ERROR', value: 'Mega fuera de línea' };
    }

    log(`UART 9600 8N1 hacia el Mega: ${ins.cmd}`, 'esp');
    setStep('El ESP32 envía el comando por UART al Mega. La señal pasa por el conversor TXS0108E.');
    await hop(packet, 'mega');
    setActive('mega');

    if (!sim.megaResponds) {
      log('El Mega no contesta. El ESP32 espera el tiempo límite', 'err');
      setStep('El Mega no responde. El ESP32 espera un tiempo límite y reportará ERROR.');
      packet.classList.add('is-error');
      flash('mega', 'is-error', UART_TIMEOUT_MS);
      await sleep(UART_TIMEOUT_MS);
      return { res: 'ERROR', value: 'Sin respuesta del Mega' };
    }

    log(`I2C hacia el Uno en 0x08: ${ins.cmd}`, 'mega');
    setStep('El Mega reenvía el comando por I2C al esclavo 0x08 y espera la respuesta, hasta 3.5 segundos.');
    const wait = sleep(I2C_WAIT_MS);
    await hop(packet, 'uno');
    setActive('uno');

    if (!sim.unoResponds) {
      await wait;
      log('El Mega lee 0 bytes del esclavo 0x08: esclavo1Online = false', 'err');
      sim.unoOnline = false;
      renderFlags();
      packet.classList.add('is-error');
      flash('uno', 'is-error', 2500);
      return { res: 'ERROR', value: 'Sin respuesta del Uno' };
    }

    log(`El Uno ejecuta ${ins.cmd}`, 'uno');
    await hop(packet, 'act');
    setActive('act');
    const [value] = await Promise.all([actuate(ins.cmd), wait]);

    sim.unoOnline = true;
    renderFlags();
    log(`El Mega lee la respuesta del Uno: ${value}`, 'mega');
    setStep('El Mega leyó la respuesta. Ahora regresa por el mismo camino hasta el ESP32.');
    packet.classList.add('is-back');
    await hop(packet, 'uno');
    await hop(packet, 'mega');
    await hop(packet, 'esp');
    setActive('esp');
    return { res: 'OK', value };
  }

  async function report(ins, result, packet) {
    setActive('esp');
    const kind = result.res === 'OK' ? 'ok' : 'err';
    if (ins.origin === 'Web') {
      log(`POST /api/instrucciones/respuesta con resultado ${result.res}`, kind);
      await hop(packet, 'api');
      setActive('api');
      log('La API actualiza Log_Instruccion en la base de datos', 'api');
    } else {
      log('POST /api/instrucciones/local notifica la pulsación del botón', kind);
      await hop(packet, 'api');
      setActive('api');
      log('La API registra la ejecución local en Log_Instruccion', 'api');
    }
    await sleep(300);
    packet.remove();

    const latency = sim.now - ins.t0;
    addRow(ins, result, latency);
    sim.done += 1;
    el.done.textContent = String(sim.done);
    el.latency.textContent = ins.waited !== undefined ? fmtSeconds(ins.waited) : 'sin cola';
    setActive();
    setStep(`Instrucción ${ins.id}, ${ins.cmd}: ${result.res}. Latencia total ${fmtSeconds(latency)} desde que se ordenó.`);
    sim.busy = false;
  }

  function addRow(ins, result, latency) {
    const empty = $('.empty', el.bitacora);
    if (empty) empty.remove();
    const tr = document.createElement('tr');
    const cells = [ins.id, ins.cmd, ins.origin, result.res, result.value, fmtSeconds(latency)];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = String(text);
      if (i === 3) td.className = result.res === 'OK' ? 'res-ok' : 'res-err';
      tr.appendChild(td);
    });
    el.bitacora.prepend(tr);
    while (el.bitacora.children.length > 10) el.bitacora.removeChild(el.bitacora.lastChild);
  }

  /* ---------- Entradas ---------- */
  async function sendFromWeb(cmd) {
    const ins = { id: sim.nextId++, cmd, origin: 'Web', t0: sim.now };
    const packet = makePacket('web');
    setActive('web');
    setStep(`El operador pulsa el botón. El frontend llama a ${ROUTES[cmd]}.`);
    log(`${ROUTES[cmd]} con el token JWT`, 'web');
    await sleep(350);
    await hop(packet, 'api');
    setActive('api');
    log(`La API valida el rol y el permiso para ${cmd}`, 'api');
    await sleep(350);
    await hop(packet, 'db');
    setActive('db');
    sim.queue.push(ins);
    updateQueue();
    log(`INSERT en Instruccion_Pendiente: ${cmd}. La API responde sin esperar al hardware`, 'api');
    setStep(`${cmd} quedó en la cola. Nadie la ejecuta todavía: el ESP32 la tomará en su próxima consulta.`);
    packet.remove();
  }

  async function pressLocal() {
    if (sim.busy) {
      log('El ESP32 está ocupado con otra instrucción: la pulsación se ignora', 'muted');
      return;
    }
    sim.busy = true;
    const cmd = sim.bridge === SERVO_CLOSED ? 'SERVO_SUBIR' : 'SERVO_BAJAR';
    const ins = { id: sim.nextId++, cmd, origin: 'Botón físico', t0: sim.now };
    const packet = makePacket('esp');
    setActive('esp');
    log(`Botón físico del puente pulsado: ${cmd}. No pasa por la API`, 'esp');
    setStep('El ESP32 lee el botón físico y manda la orden directo al Mega. No espera a la API.');
    const result = await runChain(ins, packet);
    await report(ins, result, packet);
  }

  async function onPoll() {
    if (sim.busy) return;
    if (!sim.queue.length) {
      flash('esp', 'is-pulse', 300);
      logEmptyPoll();
      return;
    }
    const ins = sim.queue.shift();
    updateQueue();
    sim.busy = true;
    const waited = sim.now - ins.t0;
    ins.waited = waited;
    const packet = makePacket('db');
    setActive('db');
    log(`GET /api/instrucciones/pendientes devuelve ${ins.cmd}, id ${ins.id}`, 'esp');
    setStep(`El ESP32 consulta la API y recibe ${ins.cmd}. La instrucción esperó ${fmtSeconds(waited)} en la cola.`);
    await hop(packet, 'esp');
    setActive('esp');
    const result = await runChain(ins, packet);
    await report(ins, result, packet);
  }

  /* ---------- Reloj de la simulación ---------- */
  let lastFrame = performance.now();
  function frame(t) {
    const dt = Math.min(t - lastFrame, 250) * sim.speed;
    lastFrame = t;
    sim.now += dt;

    sim.pollLeft -= dt;
    if (sim.pollLeft <= 0) { sim.pollLeft += POLL_MS; onPoll(); }

    sim.pingLeft -= dt;
    if (sim.pingLeft <= 0) { sim.pingLeft += PING_MS; onPing(); }

    checkFlags();

    const frac = Math.max(0, sim.pollLeft) / POLL_MS;
    el.ring.style.strokeDashoffset = String(RING_LEN * (1 - frac));
    el.pollTime.textContent = fmtSeconds(Math.max(0, sim.pollLeft));
    requestAnimationFrame(frame);
  }

  /* ---------- Controles ---------- */
  $$('[data-cmd]').forEach(btn => btn.addEventListener('click', () => sendFromWeb(btn.dataset.cmd)));
  $('#btnLocal').addEventListener('click', pressLocal);

  el.speed.addEventListener('change', () => { sim.speed = Number(el.speed.value); });

  el.mega.addEventListener('change', () => {
    sim.megaResponds = el.mega.checked;
    log(sim.megaResponds ? 'El Mega vuelve a responder' : 'El Mega deja de responder', sim.megaResponds ? 'ok' : 'err');
  });
  el.uno.addEventListener('change', () => {
    sim.unoResponds = el.uno.checked;
    if (sim.unoResponds && sim.megaOnline) { sim.unoOnline = true; renderFlags(); }
    log(sim.unoResponds ? 'El Uno vuelve a responder en 0x08' : 'El Uno deja de responder en 0x08', sim.unoResponds ? 'ok' : 'err');
  });

  /* ---------- Arranque ---------- */
  sim.speed = Number(el.speed.value);
  renderBridge();
  renderCart();
  renderFlags();
  updateQueue();
  log('Sistema listo. El ESP32 consulta la API cada 5 segundos', 'ok');
  requestAnimationFrame(frame);
})();

/* ====================================================================
   Decoración: estrellas, ciudad con ventanas, revelado, contadores,
   paralaje, barra de progreso y visor de imágenes
==================================================================== */
(() => {
  'use strict';
  document.documentElement.classList.add('js');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const NS = 'http://www.w3.org/2000/svg';

  /* Estrellas */
  const stars = document.getElementById('stars');
  if (stars) {
    for (let i = 0; i < 70; i++) {
      const s = document.createElement('i');
      s.style.left = rnd(0, 100).toFixed(1) + '%';
      s.style.top = rnd(0, 100).toFixed(1) + '%';
      s.style.setProperty('--d', rnd(2, 5).toFixed(1) + 's');
      s.style.setProperty('--dl', rnd(0, 4).toFixed(1) + 's');
      stars.appendChild(s);
    }
  }

  /* Ciudad con ventanas que parpadean */
  const city = document.getElementById('cityScape');
  if (city) {
    const el = (name, attrs) => {
      const n = document.createElementNS(NS, name);
      Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
      return n;
    };
    const addBuilding = (x, w, h, cls) => {
      city.appendChild(el('rect', { x, y: 240 - h, width: w, height: h, class: cls }));
      for (let wx = x + 6; wx < x + w - 8; wx += 11) {
        for (let wy = 240 - h + 10; wy < 232; wy += 14) {
          if (Math.random() > 0.42) continue;
          const r = el('rect', { x: wx, y: wy, width: 4, height: 6, class: 'win on' });
          if (Math.random() > 0.55 && !reduce) {
            r.classList.add('fl');
            r.style.setProperty('--d', rnd(3, 9).toFixed(1) + 's');
            r.style.setProperty('--dl', rnd(0, 6).toFixed(1) + 's');
          }
          city.appendChild(r);
        }
      }
    };
    for (let x = -10; x < 1450; x += rnd(34, 70)) addBuilding(x, rnd(34, 68), rnd(50, 130), 'b2');
    for (let x = 0; x < 1450; x += rnd(52, 96)) {
      if (x > 840 && x < 980) continue;
      addBuilding(x, rnd(46, 84), rnd(80, 190), 'b1');
    }
    /* Torre escalonada con antena, inspirada en el Empire State */
    const g = el('g', { class: 'esb' });
    [[880, 100, 90], [892, 76, 130], [904, 52, 168], [914, 32, 200], [921, 18, 216]].forEach(([x, w, h]) => {
      g.appendChild(el('rect', { x, y: 240 - h, width: w, height: h }));
    });
    g.appendChild(el('rect', { x: 929, y: 18, width: 2, height: 24 }));
    city.appendChild(g);
    city.appendChild(el('circle', { cx: 930, cy: 16, r: 3.2, class: 'beacon' }));
    for (let wy = 60; wy < 230; wy += 13) {
      for (let wx = 912; wx < 950; wx += 9) {
        if (Math.random() > 0.35) continue;
        const r = el('rect', { x: wx, y: wy, width: 3, height: 5, class: 'win on' });
        if (!reduce) { r.classList.add('fl'); r.style.setProperty('--d', rnd(3, 8).toFixed(1) + 's'); r.style.setProperty('--dl', rnd(0, 5).toFixed(1) + 's'); }
        city.appendChild(r);
      }
    }
  }

  /* Revelado al hacer scroll */
  const targets = document.querySelectorAll('.section-head, .link-card, .layer, .card, .comp, .mini-card, .frame, .figure, .place, .shot, .concl, .concept, .timeline-card, .takeaways, .progress, .sim, .tabs, .tabpanel');
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    targets.forEach(t => {
      const sibs = t.parentElement ? Array.from(t.parentElement.children) : [];
      t.style.setProperty('--delay', Math.min(sibs.indexOf(t), 6) * 0.07 + 's');
      t.classList.add('reveal');
      io.observe(t);
    });
  }

  /* Contadores del hero */
  const counters = document.querySelectorAll('[data-count]');
  counters.forEach(c => {
    const end = Number(c.dataset.count);
    if (reduce) return;
    c.textContent = '0';
    const t0 = performance.now() + 250;
    const dur = 1500;
    const tick = now => {
      const p = Math.min(Math.max((now - t0) / dur, 0), 1);
      c.textContent = String(Math.round(end * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  /* Paralaje del hero y barra de progreso */
  const bar = document.createElement('div');
  bar.className = 'scroll-progress';
  document.body.appendChild(bar);
  const hero = document.getElementById('heroPhoto');
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';
      if (hero && !reduce && y < 1400) hero.style.setProperty('--py', (y * 0.28).toFixed(1) + 'px');
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* Visor de imágenes */
  const lb = document.getElementById('lightbox');
  const lbImg = lb.querySelector('img');
  const lbCap = lb.querySelector('.lb-cap');
  const close = () => { lb.hidden = true; document.body.style.overflow = ''; };
  document.querySelectorAll('[data-zoom]').forEach(img => {
    img.addEventListener('click', () => {
      lbImg.src = img.currentSrc || img.src;
      lbImg.alt = img.alt;
      const fig = img.closest('figure');
      const cap = fig && fig.querySelector('figcaption');
      lbCap.textContent = cap ? cap.textContent : img.alt;
      lb.hidden = false;
      document.body.style.overflow = 'hidden';
      lb.querySelector('.lb-close').focus();
    });
  });
  lb.addEventListener('click', e => { if (e.target !== lbImg) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !lb.hidden) close(); });
})();

/* ====================================================================
   Video por capítulos y cuenta regresiva a la presentación final
==================================================================== */
(() => {
  'use strict';
  const video = document.getElementById('projVideo');
  const list = document.getElementById('chapters');
  if (video && list) {
    const btns = Array.from(list.querySelectorAll('button'));
    const starts = btns.map(b => Number(b.dataset.t));
    btns.forEach(b => b.addEventListener('click', () => {
      video.currentTime = Number(b.dataset.t);
      video.play().catch(() => {});
      video.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    video.addEventListener('timeupdate', () => {
      let idx = 0;
      starts.forEach((s, i) => { if (video.currentTime >= s) idx = i; });
      btns.forEach((b, i) => b.classList.toggle('is-playing', i === idx && !video.paused));
    });
    video.addEventListener('pause', () => btns.forEach(b => b.classList.remove('is-playing')));
  }

  const tag = document.getElementById('deadlineText');
  if (tag) {
    const target = new Date(2026, 9, 31);
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const days = Math.round((target - start) / 86400000);
    tag.textContent = days > 1 ? `faltan ${days} días` : days === 1 ? 'es mañana' : days === 0 ? 'es hoy' : '';
  }
})();
