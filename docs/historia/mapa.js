// Mapa esquemático (desenhado à mão, fora de escala fina) da rota do traslado, em SVG puro.
// Sem serviço externo de mapas. Projeção equirretangular: 10 unidades por grau.
(function () {
  const S = 10, LON0 = -100, LAT0 = 42;
  const xy = (lat, lon) => [(lon - LON0) * S, (LAT0 - lat) * S];
  const NS = 'http://www.w3.org/2000/svg';

  // Continente americano (recorte), [lon, lat]. Simplificado.
  const TERRA = [
    [-100, 44], [-74, 44], [-74.0, 40.5], [-75.1, 38.8], [-76.0, 37.0], [-75.5, 35.2], [-76.5, 34.6], [-77.9, 33.9],
    [-79.9, 32.7], [-81.0, 32.0], [-81.4, 30.3], [-80.6, 28.4], [-80.0, 26.7], [-80.1, 25.8], [-80.4, 25.2], [-81.1, 25.1],
    [-81.8, 26.1], [-82.7, 27.8], [-83.0, 29.1], [-85.0, 29.7], [-87.2, 30.4], [-88.0, 30.4], [-89.2, 29.1], [-90.5, 29.1],
    [-91.3, 29.5], [-94.0, 29.7], [-97.3, 27.7], [-97.2, 25.9], [-97.8, 22.2], [-96.1, 19.2], [-94.4, 18.1], [-91.8, 18.6],
    [-90.5, 19.8], [-90.4, 20.9], [-89.7, 21.3], [-87.0, 21.6], [-86.8, 21.1], [-87.4, 20.2], [-88.3, 18.5], [-88.2, 17.5],
    [-88.6, 15.8], [-86.0, 15.9], [-83.2, 15.0], [-83.7, 12.0], [-83.0, 10.0], [-79.9, 9.4], [-77.4, 8.7], [-75.5, 10.4],
    [-74.8, 11.0], [-74.2, 11.3], [-71.7, 12.4], [-71.6, 11.6], [-70.2, 11.6], [-70.2, 12.2], [-69.6, 11.4], [-68.0, 10.5],
    [-67.0, 10.6], [-64.2, 10.5], [-61.9, 10.7], [-61.0, 8.6], [-59.8, 8.3], [-58.2, 6.8], [-55.2, 5.9], [-52.3, 4.9],
    [-51.4, 4.4], [-50.5, 2.0], [-50.0, 0.8], [-50.9, -0.1], [-49.2, 0.2], [-48.4, -0.6], [-48.5, -1.4], [-47.3, -0.6],
    [-44.3, -2.5], [-41.8, -2.9], [-38.5, -3.7], [-37.0, -4.9], [-35.3, -5.2], [-35.2, -5.8], [-34.8, -7.1], [-34.9, -8.1],
    [-35.7, -9.7], [-37.0, -11.0], [-38.5, -13.0], [-39.0, -14.8], [-39.0, -16.4], [-39.2, -17.8], [-40.3, -20.3],
    [-41.0, -22.0], [-42.0, -22.9], [-43.2, -23.0], [-44.3, -23.0], [-45.1, -23.5], [-46.3, -24.0], [-47.5, -24.7],
    [-48.5, -25.5], [-48.6, -26.5], [-48.6, -34], [-72, -34], [-72, -18], [-76, -14], [-81, -5], [-80, -2], [-80.5, 1],
    [-78.8, 1.8], [-77.4, 4], [-77.3, 7.0], [-78.0, 8.3], [-79.5, 8.9], [-80.5, 7.5], [-82.0, 8.2], [-85.7, 9.9],
    [-85.8, 11.0], [-87.5, 13.0], [-90.5, 13.9], [-92.3, 14.6], [-94, 16.1], [-96.5, 15.7], [-105, 19], [-105, 44],
  ];
  const ILHAS = [
    [[-84.95, 21.86], [-84.0, 22.7], [-82.5, 23.1], [-81.0, 23.1], [-79.5, 22.4], [-77.5, 21.7], [-75.7, 21.1], [-74.15, 20.2],
      [-75.0, 19.9], [-77.7, 19.85], [-77.1, 20.5], [-78.5, 21.5], [-80.5, 22.0], [-81.8, 22.2], [-83.3, 22.2], [-84.4, 21.8]],
    [[-74.45, 18.4], [-72.8, 19.9], [-71.6, 19.9], [-70.0, 19.65], [-69.0, 19.0], [-68.35, 18.6], [-68.8, 18.2], [-70.0, 18.2],
      [-71.0, 17.6], [-71.7, 18.0], [-73.4, 18.2], [-74.4, 18.3]],
    [[-78.35, 18.45], [-77.0, 18.5], [-76.2, 18.0], [-76.9, 17.85], [-77.8, 17.9]],
    [[-67.25, 18.5], [-65.6, 18.4], [-65.6, 18.0], [-67.2, 17.95]],
    [[-61.9, 10.85], [-60.9, 10.85], [-61.0, 10.1], [-61.9, 10.05]],
  ];
  // Ilhas pequenas: [lon, lat, raio em graus]
  const ILHOTAS = [[-78.0, 24.6, .5], [-78.3, 26.6, .35], [-77.2, 26.4, .35], [-76.3, 25.2, .3], [-75.9, 23.6, .3],
    [-75.1, 23.2, .25], [-73.4, 21.0, .3], [-72.0, 21.75, .25], [-62.7, 17.3, .12], [-61.8, 17.1, .14], [-61.5, 16.2, .2],
    [-61.35, 15.4, .15], [-61.0, 14.65, .17], [-60.95, 13.9, .15], [-61.2, 13.25, .12], [-59.55, 13.15, .12],
    [-61.7, 12.1, .1], [-60.7, 11.25, .12], [-64.8, 18.3, .1], [-63.05, 18.05, .1]];
  const ROTULOS = [['ESTADOS UNIDOS', 34.5, -86.5], ['OCEANO ATLÂNTICO', 25, -63], ['MAR DO CARIBE', 15, -73],
    ['BRASIL', -9, -53], ['VENEZUELA', 6.5, -66], ['COLÔMBIA', 4, -73.5]];

  const el = (tag, attrs = {}, pai) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (pai) pai.appendChild(e);
    return e;
  };
  const caminho = (pts) => 'M' + pts.map(([lon, lat]) => xy(lat, lon).map((n) => n.toFixed(1)).join(' ')).join('L') + 'Z';

  /** Ponto da rota no índice fracionário i (trechos retos entre aeródromos). */
  function pontoNaRota(i) {
    const R = window.H.ROTA, a = Math.max(0, Math.min(R.length - 1, Math.floor(i))), b = Math.min(R.length - 1, a + 1), t = Math.max(0, Math.min(1, i - a));
    const [x1, y1] = xy(R[a].lat, R[a].lon), [x2, y2] = xy(R[b].lat, R[b].lon);
    return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, ang: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI };
  }

  // Câmeras: centro (lat, lon) e largura em graus de longitude.
  const CAMS = {
    geral: [6, -62, 62], tennessee: [33, -80, 16], pineyflats: [36.42, -82.32, 5],
    vitoria: [-20.3, -41.5, 9], sudeste: [-22.4, -44.5, 9], rio: [-22.4, -43.9, 7], brasil: [-8, -46, 30],
  };

  /**
   * Monta o mapa dentro de um <svg>. Devolve o controlador:
   * mapa.alvo({cam, rota}) define para onde ir; a animação é suave (lerp por quadro).
   */
  function montar(svg, opcoes = {}) {
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.classList.add('mapa');
    const defs = el('defs', {}, svg);
    defs.innerHTML = `
      <radialGradient id="mar" cx="55%" cy="40%" r="75%"><stop offset="0" stop-color="#0b1520"/><stop offset="1" stop-color="#04070b"/></radialGradient>
      <filter id="brilho" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
    el('rect', { x: -500, y: -500, width: 2000, height: 2000, fill: 'url(#mar)' }, svg);
    const grade = el('g', { class: 'grade' }, svg);
    for (let lon = -100; lon <= -30; lon += 10) { const [x] = xy(0, lon); el('line', { x1: x, y1: -200, x2: x, y2: 1000 }, grade); }
    for (let lat = 40; lat >= -40; lat -= 10) { const [, y] = xy(lat, 0); el('line', { x1: -200, y1: y, x2: 1000, y2: y }, grade); }
    const [, yEq] = xy(0, 0);
    el('line', { x1: -200, y1: yEq, x2: 1000, y2: yEq, class: 'equador' }, grade);

    const terra = el('g', { class: 'terra' }, svg);
    el('path', { d: caminho(TERRA) }, terra);
    ILHAS.forEach((p) => el('path', { d: caminho(p) }, terra));
    ILHOTAS.forEach(([lon, lat, r]) => { const [x, y] = xy(lat, lon); el('circle', { cx: x, cy: y, r: r * S }, terra); });

    const rot = el('g', { class: 'rotulos' }, svg);
    ROTULOS.forEach(([t, lat, lon]) => { const [x, y] = xy(lat, lon); el('text', { x, y }, rot).textContent = t; });

    const R = window.H.ROTA;
    const pts = R.map((p) => xy(p.lat, p.lon));
    const iVit = window.H.IDX.SBVT;
    el('polyline', { points: pts.slice(0, iVit + 1).join(' '), class: 'rota-plano' }, svg);
    el('polyline', { points: pts.slice(iVit).join(' '), class: 'rota-plano rota-sp' }, svg);
    const feito = el('polyline', { points: '', class: 'rota-feita', filter: 'url(#brilho)' }, svg);

    const gPts = el('g', { class: 'pontos' }, svg);
    const jaDesenhado = {};
    const pontos = R.map((p, i) => {
      if (jaDesenhado[p.cod]) return jaDesenhado[p.cod]; // mesma parada duas vezes na rota
      const [x, y] = pts[i];
      const g = el('g', { class: 'pt' + (p.aprox ? ' aprox' : '') + (['89TN', 'SBVT', 'HPRK', 'SBJR'].includes(p.cod) ? ' chave' : ''), transform: `translate(${x} ${y})` }, gPts);
      el('circle', { class: 'pt-c' }, g);
      const t = el('text', { class: 'pt-t' }, g);
      t.textContent = p.nome === p.cod ? p.cod : p.nome;
      const c = el('text', { class: 'pt-cod' }, g);
      c.textContent = p.cod === 'HPRK' ? 'SP' : p.cod;
      const tt = el('title', {}, g); tt.textContent = `${p.cod} · ${p.nome}, ${p.onde}${p.aprox ? ' (posição aproximada)' : ''}`;
      jaDesenhado[p.cod] = g;
      return g;
    });

    // marcadores extras (ex.: decisões no protótipo B)
    const gExtra = el('g', { class: 'extras' }, svg);

    const heli = el('g', { class: 'heli' }, svg);
    heli.innerHTML = `<circle class="heli-pulso" r="14"/><circle class="heli-disco" r="9"/>
      <g class="heli-corpo"><path d="M-6 0 L4 -2.6 Q7 0 4 2.6 Z"/><path d="M-6 0 L-12 0" /><path d="M-12 -3 L-12 3"/></g>`;

    let vb = null, alvoVb = null, alvoI = 0, atualI = 0, segue = false;
    const lerp = (a, b, t) => a + (b - a) * t;

    function camParaVb(nome, i) {
      const r = svg.getBoundingClientRect(), asp = (r.height || 1) / (r.width || 1);
      if (nome === 'tudo') {
        // rota inteira dentro da área visível do palco, com folga para o letreiro (topo) e a régua (embaixo)
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const estreito = r.width < 600, pT = estreito ? 52 : 78, pB = estreito ? 52 : 80, pL = 40, pR = estreito ? 40 : 60;
        const visTopo = Math.max(0, -r.top), visBase = Math.min(r.height, innerHeight - r.top);
        const aW = Math.max(50, r.width - pL - pR), aH = Math.max(50, visBase - visTopo - pT - pB);
        const k = Math.max((x1 - x0) / aW, (y1 - y0) / aH);
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        return { x: cx - (pL + aW / 2) * k, y: cy - (visTopo + pT + aH / 2) * k, w: r.width * k, h: r.height * k };
      }
      // deslocX: empurra o alvo para a direita (quando há texto por cima, à esquerda)
      const desl = r.width > 900 ? (opcoes.deslocX || 0) : 0;
      let lat, lon, larg, x, y;
      if (nome === 'segue') { const p = pontoNaRota(i); larg = 24; x = p.x; y = p.y; }
      else {
        [lat, lon, larg] = CAMS[nome] || CAMS.geral;
        [x, y] = xy(lat, lon);
      }
      // em tela estreita, abre mais para caber a mesma região
      if (r.width < 600) larg *= 1.35;
      const w = larg * S, h = w * asp;
      return { x: x - w / 2 - w * desl, y: y - h / 2, w, h };
    }

    let camNome = 'geral';
    function alvo({ cam, rota }) { camNome = cam; alvoI = rota; segue = cam === 'segue'; }

    function quadro() {
      atualI = lerp(atualI, alvoI, 0.14);
      if (Math.abs(atualI - alvoI) < 0.002) atualI = alvoI;
      alvoVb = camParaVb(camNome, atualI);
      if (!vb) vb = { ...alvoVb };
      const t = segue ? 0.2 : 0.07;
      for (const k of ['x', 'y', 'w', 'h']) vb[k] = lerp(vb[k], alvoVb[k], t);
      svg.setAttribute('viewBox', `${vb.x.toFixed(2)} ${vb.y.toFixed(2)} ${vb.w.toFixed(2)} ${vb.h.toFixed(2)}`);
      const r = svg.getBoundingClientRect();
      const k = vb.w / Math.max(1, r.width); // unidades do mapa por pixel na tela
      svg.style.setProperty('--k', k.toFixed(4));
      svg.classList.toggle('perto', k < 0.09);
      svg.classList.toggle('muito-perto', k < 0.03);

      const p = pontoNaRota(atualI);
      heli.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) scale(${k.toFixed(4)}) rotate(${p.ang.toFixed(1)})`);
      const n = Math.floor(atualI);
      const feitos = pts.slice(0, n + 1).concat(atualI > n ? [[p.x, p.y]] : []);
      feito.setAttribute('points', feitos.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
      const passou = new Set(pontos.filter((g, i) => i <= atualI + 0.02));
      new Set(pontos).forEach((g) => g.classList.toggle('passou', passou.has(g)));
      if (opcoes.aoQuadro) opcoes.aoQuadro(atualI, k);
      requestAnimationFrame(quadro);
    }
    requestAnimationFrame(quadro);

    /** Posição na tela (px, relativa ao <svg>) de um ponto lat/lon, com a câmera atual. */
    function paraTela(lat, lon) {
      if (!vb) return null;
      const r = svg.getBoundingClientRect(), [x, y] = xy(lat, lon);
      return { x: (x - vb.x) / vb.w * r.width, y: (y - vb.y) / vb.h * r.height };
    }

    return { alvo, xy, gExtra, el, paraTela, trechoAtual: () => atualI };
  }

  window.MAPA = { montar, xy, pontoNaRota };
})();
