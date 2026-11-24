// Motor comum das variações da Rota: monta mapa fixo + passos de texto, régua do tempo e rolagem.
// Cada variação decide onde as decisões aparecem (passos próprios, bandeiras no mapa, coluna lateral…).
(function () {
  const { CAP, ROTA, REGUA } = window.H;
  const esc = window.UI.esc;

  const paradas = (a, b) => ROTA.slice(Math.ceil(a) + (a === 0 ? 0 : 1), Math.floor(b) + 1)
    .map((p) => `<span>${p.cod}<em>${esc(p.nome === p.cod ? p.onde : p.nome)}</em></span>`).join('');

  /** Cartão enxuto de um capítulo (sem decisões; cada variação põe as suas). */
  function cartao(c, extra = '') {
    const nAnd = (c.passos || []).filter((p) => p[1] === 'em andamento').length;
    const nOk = (c.passos || []).filter((p) => p[1] === 'concluído').length;
    return `<div class="cartao">
      <div class="quando">${esc(c.quando)}</div>
      <h2>${c.id === 'abertura' ? 'Do Tennessee<br>a <span>Jacarepaguá</span>' : esc(c.titulo)}</h2>
      <p class="txt">${window.UI.datas(esc(c.texto))}</p>
      ${c.numeros ? `<div class="numeros-grandes">${c.numeros.map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>` : ''}
      ${c.regiao ? `<div class="paradas">${paradas(c.rota[0], c.rota[1])}</div>` : ''}
      ${c.nota ? `<div class="nota">${esc(c.nota)}</div>` : ''}
      ${(c.div || []).map(window.UI.divergencia).join('')}
      ${c.passos ? `<div class="passos-box"><div class="passos-cab">${c.passos.length > 1 ? 'Passos' : 'Passo'}<span>${[nAnd ? `${nAnd} em andamento` : '', nOk ? `${nOk} concluído${nOk > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</span></div>${window.UI.passos(c.passos)}</div>` : ''}
      ${extra}
      ${c.id === 'abertura' ? '<div class="rolar">role para acompanhar a viagem</div>' : ''}
    </div>`;
  }

  /**
   * passos: [{ tipo, ci, html, classe?, cena?, palco? }] — ci = índice do capítulo (câmera, rota, régua).
   * ganchos: aoTrocar(passo, i), aoRolar(passo, i, p), aoQuadro(i, k).
   */
  function montar({ nome, passos, aoTrocar, aoRolar, aoQuadro, deslocX, resumo = true, encaixe = false }) {
    window.UI.topo(nome);
    document.body.insertAdjacentHTML('beforeend', `
      <main class="historia">
        <div class="palco" id="palco">
          <svg id="mapa"></svg><div class="veu"></div><div class="cena" id="cena"></div><div class="camada" id="camada"></div>
          <div class="hud"><span class="hud-q" id="hudQ"></span><span class="hud-t" id="hudT"></span></div>
          <div class="regua" id="regua"></div>
        </div>
        <div class="texto" id="texto">${passos.map((p, i) => `<section class="cap ${p.classe || ''}" data-i="${i}">${p.html}</section>`).join('')}</div>
      </main>
      ${resumo ? `<section class="fim" id="resumo"><div class="fim-in"><h2>O que precisa sair primeiro</h2>
        <p>${Object.keys(window.H.DEC).length ? 'Todas as encruzilhadas, na ordem em que vencem. Clique para abrir.' : 'Decisões em aberto e o que ainda falta fazer.'}</p>${window.UI.resumo()}</div></section>` : ''}`);
    window.UI.ligar();

    // régua
    const nR = REGUA.length - 1, pct = (m) => `${(Math.max(0, Math.min(nR, m)) / nR * 100).toFixed(2)}%`;
    const agora = new Date(), mesHoje = (agora.getFullYear() - 2026) * 12 + agora.getMonth() - 10 + (agora.getDate() - 1) / 30;
    document.getElementById('regua').innerHTML = `<div class="trilho"></div><div class="feito" id="rFeito"></div>
      ${REGUA.map((m, i) => `<span class="t" style="left:${pct(i)}"></span><span class="m" style="left:${pct(i)}">${m}</span>`).join('')}
      <span class="hoje" style="left:${pct(mesHoje)}">hoje</span><span class="cursor" id="rCursor"></span>`;

    const palco = document.getElementById('palco'), cenaEl = document.getElementById('cena');
    const hudQ = document.getElementById('hudQ'), hudT = document.getElementById('hudT');
    const secoes = [...document.querySelectorAll('#texto .cap')];
    const mapa = window.MAPA.montar(document.getElementById('mapa'), { aoQuadro, deslocX });
    const suave = (t) => t * t * (3 - 2 * t);
    let cenaAtual, palcoAtual, ativo = -1;
    // encaixe: ao chegar num capítulo de viagem (indo para a frente), o helicóptero percorre o trecho em DUR ms
    const DUR = 1800; let tAnim = 0, pAnim = 1, rafAnim = 0;
    const anda = (ps) => ps.tipo === 'cap' && CAP[ps.ci].rota[0] !== CAP[ps.ci].rota[1];

    function noScroll() {
      const linha = innerHeight * (innerWidth < 900 ? 0.78 : 0.55);
      let i = 0;
      secoes.forEach((el, j) => { if (el.getBoundingClientRect().top <= linha) i = j; });
      // fim da página: o último capítulo pode não alcançar a linha; considera-o ativo e completo
      const noFim = scrollY + innerHeight >= document.documentElement.scrollHeight - 4;
      if (noFim && !resumo) i = secoes.length - 1;
      if (encaixe && i !== ativo) {
        if (ativo >= 0 && i > ativo && anda(passos[i])) { tAnim = performance.now(); pAnim = 0; } else pAnim = 1;
      }
      if (encaixe && pAnim < 1) { pAnim = Math.min(1, (performance.now() - tAnim) / DUR); cancelAnimationFrame(rafAnim); rafAnim = requestAnimationFrame(noScroll); }
      const r = secoes[i].getBoundingClientRect(), p = encaixe ? pAnim : noFim && !resumo ? 1 : Math.max(0, Math.min(1, (linha - r.top) / (r.height * 0.8)));
      const passo = passos[i], c = CAP[passo.ci], [a, b] = passo.tipo === 'cap' ? c.rota : [c.rota[1], c.rota[1]];
      const rota = a + (b - a) * suave(p);
      mapa.alvo({ cam: c.cam, rota });
      if (i !== ativo) {
        secoes.forEach((el, j) => { el.classList.toggle('ativo', j === i); el.classList.toggle('passado', j < i); el.classList.toggle('futuro', j > i); });
        ativo = i; hudQ.textContent = c.quando;
        if (aoTrocar) aoTrocar(passo, i);
      }
      const cena = passo.cena !== undefined ? passo.cena : c.cena;
      if (cena !== cenaAtual) {
        cenaAtual = cena;
        if (cena) cenaEl.innerHTML = window.UI.cena(cena);
        palco.classList.toggle('com-cena', !!cena);
        palco.classList.toggle('cena-voo', cena === 'voo');
      }
      if ((passo.palco || '') !== palcoAtual) {
        if (palcoAtual) palco.classList.remove(palcoAtual);
        palcoAtual = passo.palco || '';
        if (palcoAtual) palco.classList.add(palcoAtual);
      }
      const n = Math.min(ROTA.length - 2, Math.floor(rota + 1e-6)), resto = rota - n;
      if (a !== b && resto > 0.04 && resto < 0.96) hudT.innerHTML = `trecho <b>${n + 1}</b> · ${ROTA[n].cod} → <b>${ROTA[n + 1].cod}</b> · ${esc(ROTA[n + 1].onde)}`;
      else { const q = ROTA[Math.round(rota)]; hudT.innerHTML = `<b>${q.cod}</b> · ${esc(q.nome)}, ${esc(q.onde)}`; }

      const prox = passos[i + 1] ? CAP[passos[i + 1].ci].mes : c.mes;
      const m = c.mes + (prox - c.mes) * (encaixe && !anda(passo) ? 0 : p);
      document.getElementById('rCursor').style.left = pct(m);
      document.getElementById('rFeito').style.width = pct(m);
      if (aoRolar) aoRolar(passo, i, p);
    }
    addEventListener('scroll', noScroll, { passive: true });
    // Encaixe (só no computador): um gesto da roda/touchpad = um capítulo. O resto do mesmo gesto
    // (giros seguidos, inércia do touchpad) é ignorado. Capítulo mais alto que a tela rola livre até o fim.
    const pagina = () => encaixe && innerWidth >= 900 && document.documentElement.classList.contains('encaixe');
    const alvoDe = (i) => (i <= 0 ? 0 : Math.round(secoes[i].getBoundingClientRect().top + scrollY));
    let movendoAte = 0;
    function irPara(i) {
      i = Math.max(0, Math.min(secoes.length - 1, i));
      if (!pagina()) { secoes[i].scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      movendoAte = performance.now() + 750;
      scrollTo({ top: alvoDe(i), behavior: 'smooth' });
    }
    if (encaixe) {
      const atual = () => { let i = 0; secoes.forEach((el, j) => { if (el.getBoundingClientRect().top <= 10) i = j; }); return i; };
      // quanto ainda dá para rolar dentro do capítulo atual, na direção do gesto
      const sobra = (i, dir) => { const r = (secoes[i].querySelector('.cartao') || secoes[i]).getBoundingClientRect(); return dir > 0 ? r.bottom + 4 - innerHeight : (i === 0 ? Math.min(scrollY, 4 - r.top) : 4 - r.top); };
      const passo = (dir) => { const i = atual(); irPara(dir > 0 ? i + 1 : (sobra(i, -1) > 2 && i > 0 ? i : i - 1)); };
      let ultimo = 0, gesto = { usado: false, livre: false };
      addEventListener('wheel', (e) => {
        if (!pagina() || e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
        const agora = performance.now();
        if (agora - ultimo > 260) gesto = { usado: false, livre: false }; // pausa: começou outro gesto
        ultimo = agora;
        const dir = Math.sign(e.deltaY);
        if (agora < movendoAte || gesto.usado) { e.preventDefault(); return; }
        if (sobra(atual(), dir) > 2) { gesto.livre = true; return; } // lendo um capítulo longo
        e.preventDefault();
        if (gesto.livre) return; // chegou ao fim do capítulo longo no meio do gesto: para aqui
        gesto.usado = true;
        passo(dir);
      }, { passive: false });
      addEventListener('keydown', (e) => {
        if (!pagina() || e.altKey || e.ctrlKey || e.metaKey || /input|textarea|select/i.test(e.target.tagName)) return;
        const dir = { ArrowDown: 1, PageDown: 1, ' ': e.shiftKey ? -1 : 1, ArrowUp: -1, PageUp: -1 }[e.key];
        if (!dir) return;
        if (sobra(atual(), dir) > 2 && e.key !== 'PageDown' && e.key !== 'PageUp') return;
        e.preventDefault();
        if (performance.now() >= movendoAte) passo(dir);
      });
    }
    addEventListener('resize', noScroll);
    requestAnimationFrame(noScroll);
    return { mapa, palco, secoes, irPara };
  }

  window.ROTA_BASE = { montar, cartao };
})();
