// Componentes comuns: encruzilhada (decisão), divergência, cenas (trilhas/horizonte) e resumo.
(function () {
  const { DEC, DIV, CAP } = window.H;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const hoje = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const data = (s) => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d || 1); };
  const diasAte = (s) => Math.round((data(s) - hoje()) / 86400000);
  const dataBR = (s) => { const [a, m, d] = s.split('-'); return d ? `${d}/${m}/${a.slice(2)}` : `${MESES[+m - 1]}/${a.slice(2)}`; };

  // destaca datas (dd/mm ou dd/mm/aa) dentro de um texto já escapado
  const datas = (html) => String(html).replace(/(\d{1,2}\/\d{2}(?:\/\d{2,4})?)/g, '<b class="data">$1</b>');

  function prazoTexto(d) {
    if (d.prazo) {
      const n = diasAte(d.prazo);
      return `até ${dataBR(d.prazo)} · ${n > 1 ? `faltam ${n} dias` : n === 1 ? 'falta 1 dia' : n === 0 ? 'hoje' : 'vencido'}`;
    }
    return d.quando || 'sem prazo definido';
  }
  const urgente = (d) => (d.prazo ? diasAte(d.prazo) <= 21 : /entrega|financiamento/.test(d.quando || ''));

  function numeros(lista) {
    if (!lista || !lista.length) return '';
    return `<div class="ez-nums">${lista.map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>`;
  }

  function simulacao(d) {
    if (d.sim === 'folga') {
      return `<div class="ez-sim" data-sim="folga">
        <label>E se o 1º voo for em <b class="sim-mes">set/27</b>?</label>
        <input type="range" min="0" max="6" step="1" value="1" aria-label="Mês do 1º voo">
        <div class="sim-escala"><span>ago/27</span><span>fev/28</span></div>
        <div class="sim-saida"></div></div>`;
    }
    if (d.sim === 'cambio') {
      return `<div class="ez-sim" data-sim="cambio">
        <label>Parcela do banco (US$ 56.582) com o dólar a</label>
        <div class="sim-botoes"><button class="on" data-v="5.75">R$ 5,75 · plano</button><button data-v="6.90">R$ 6,90 · +20%</button></div>
        <div class="sim-saida"></div></div>`;
    }
    return '';
  }

  /** Decisão completa, com opções clicáveis. sel = índice da opção aberta (padrão: a recomendada ou a 1ª). */
  function encruzilhada(id, sel) {
    const d = DEC[id];
    if (!d) return '';
    const iRec = d.opcoes.findIndex((o) => o.rec);
    const s = sel ?? (iRec >= 0 ? iRec : 0);
    const temDetalhe = d.opcoes.some((o) => o.numeros || o.nota);
    return `<div class="ez ${urgente(d) ? 'urg' : ''}" data-ez="${id}">
      <div class="ez-k"><span class="ez-tag">Encruzilhada</span><span>decide: ${esc(d.quemDecide)}</span><span class="ez-prazo">${esc(prazoTexto(d))}</span></div>
      <h4>${esc(d.titulo)}</h4>
      <p class="ez-ctx">${esc(d.contexto)}</p>
      ${d.opcoes.length ? `<div class="ez-ops" role="tablist">${d.opcoes.map((o, i) => `
        <button role="tab" class="ez-op ${i === s && temDetalhe ? 'on' : ''} ${o.rec ? 'rec' : ''}" data-i="${i}" aria-selected="${i === s}">
          ${esc(o.nome)}${o.rec ? '<i>recomendada</i>' : ''}</button>`).join('')}</div>` : ''}
      ${temDetalhe ? d.opcoes.map((o, i) => `<div class="ez-painel" data-p="${i}" ${i === s ? '' : 'hidden'}>
        ${numeros(o.numeros)}${o.nota ? `<p>${esc(o.nota)}</p>` : ''}
        ${!o.numeros && !o.nota ? '<p class="mudo">Sem números para esta opção nos materiais.</p>' : ''}</div>`).join('') : ''}
      ${d.recomendacao ? `<p class="ez-rec"><b>Recomendação</b>${esc(d.recomendacao)}</p>` : ''}
      ${simulacao(d)}
      ${d.extra ? `<p class="ez-extra">${esc(d.extra)}</p>` : ''}
      ${comum(d)}
      <p class="ez-pe"><b>Impacto:</b> ${esc(d.impacto)} <span class="ez-fonte">Fonte: ${esc(d.fonte)}</span></p>
    </div>`;
  }

  /** Decisão em destaque: todas as opções lado a lado, para comparar de uma vez. */
  // custos que não mudam com a decisão (quadro à parte, abaixo das opções)
  function comum(d) {
    if (!d.comum) return '';
    return `<div class="ezg-comum"><div class="ezg-comum-t">${esc(d.comum.titulo)}</div>
      <div class="ezg-comum-itens">${d.comum.itens.map(([v, l]) => `<div><b>${esc(v)}</b><span>${datas(esc(l))}</span></div>`).join('')}</div>
      ${d.comum.alerta ? `<p class="ezg-alerta">${esc(d.comum.alerta)}</p>` : ''}</div>`;
  }

  function encruzilhadaGrande(id) {
    const d = DEC[id];
    if (!d) return '';
    const ops = d.opcoes.length ? d.opcoes : [{ nome: 'Ainda sem opções definidas', nota: d.contexto }];
    return `<div class="ezg ${urgente(d) ? 'urg' : ''}" data-ez="${id}">
      <div class="ezg-cab">
        <div class="ezg-k"><span class="ez-tag">Encruzilhada</span><span class="ezg-prazo">${esc(prazoTexto(d))}</span></div>
        <h3>${esc(d.titulo)}</h3>
        <p class="ezg-quem">Decide: <b>${esc(d.quemDecide)}</b></p>
        ${d.opcoes.length ? `<p class="ezg-ctx">${datas(esc(d.contexto))}</p>` : ''}
      </div>
      <div class="ezg-ops" style="--n:${ops.length}">${ops.map((o) => `<div class="ezg-op ${o.rec ? 'rec' : ''}">
        ${o.rec ? '<span class="ezg-rec">recomendada</span>' : ''}<b class="ezg-nome">${esc(o.nome)}</b>
        ${o.numeros ? o.numeros.map(([v, l]) => `<div class="ezg-num"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('') : ''}
        ${o.nota ? `<p>${esc(o.nota)}</p>` : ''}${!o.numeros && !o.nota ? '<p class="mudo">Sem números nos materiais.</p>' : ''}
      </div>`).join('')}</div>
      ${d.recomendacao ? `<p class="ez-rec"><b>Recomendação</b>${esc(d.recomendacao)}</p>` : ''}
      ${simulacao(d)}
      ${d.extra ? `<p class="ez-extra">${esc(d.extra)}</p>` : ''}
      ${comum(d)}
      <p class="ez-pe"><b>Impacto:</b> ${esc(d.impacto)} <span class="ez-fonte">Fonte: ${esc(d.fonte)}</span></p>
    </div>`;
  }

  /** Decisão em uma linha; abre a completa ao clicar. */
  function encruzilhadaCurta(id) {
    const d = DEC[id];
    return `<details class="ez-curta"><summary><span class="ez-dot"></span><span class="t">${esc(d.titulo)}</span>
      <span class="p">${esc(prazoTexto(d))}</span></summary>${encruzilhada(id)}</details>`;
  }

  function divergencia(chave) {
    const d = DIV[chave];
    return `<details class="div"><summary>⚠ ${esc(d.titulo)}: os materiais não batem</summary>
      <ul>${d.versoes.map(([f, v], i) => `<li class="${i === 0 ? 'usada' : ''}"><b>${esc(v)}</b> · ${esc(f)}${i === 0 ? ' <i>usada aqui</i>' : ''}</li>`).join('')}</ul></details>`;
  }

  function passos(lista) {
    if (!lista) return '';
    return `<ul class="passos">${lista.map(([t, s, q]) => `<li class="${s === 'em andamento' ? 'and' : s === 'concluído' ? 'ok' : ''}">
      <span class="ps-s">${esc(s)}</span><span class="ps-t">${datas(esc(t))}</span>${q ? `<span class="ps-q">${datas(esc(q))}</span>` : ''}</li>`).join('')}</ul>`;
  }

  // ---------- cenas (gráficos fora do mapa) ----------
  function cena(nome) {
    if (nome === 'trilhas') {
      const M = ['fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set'];
      const barra = (de, ate, cls, txt) => `<div class="tr-bar ${cls}" style="--a:${de};--b:${ate}"><span>${txt}</span></div>`;
      return `<div class="cena-trilhas">
        <div class="cn-k">2027 · duas trilhas em paralelo</div>
        <div class="tr-grade" style="--n:${M.length}">${M.map((m) => `<span>${m}</span>`).join('')}</div>
        <div class="tr-linha"><b>Aeronave</b>${barra(0, 7, 'ponte', 'Fretada por TAM, Upstar ou Hammar')}</div>
        <div class="tr-linha"><b>Heli Eagle</b>${barra(0, 7, 'coa', 'COA na ANAC · ~6 meses')}</div>
        <div class="tr-linha"><b>Equipe</b>${barra(6, 7, 'equipe', 'Contratações')}</div>
        <div class="tr-linha"><b></b><div class="tr-marco" style="--a:7.5">1º voo</div></div>
      </div>`;
    }
    if (nome === 'horizonte') {
      const A0 = 2027, A1 = 2043, pos = (ano, mes) => ((ano + (mes - 1) / 12 - A0) / (A1 - A0) * 100).toFixed(2) + '%';
      const anos = [2027, 2030, 2033, 2036, 2039, 2042];
      const bar = (a, b, cls, txt) => `<div class="hz-bar ${cls}" style="left:${a};right:calc(100% - ${b})"><span>${txt}</span></div>`;
      return `<div class="cena-horizonte">
        <div class="cn-k">De 2027 a 2042 · como a aeronave é paga</div>
        <div class="hz-eixo">${anos.map((a) => `<span style="left:${pos(a, 1)}">${a}</span>`).join('')}</div>
        <div class="hz-linha"><b>Banco</b><div class="hz-trilho">${bar(pos(2027, 12), pos(2039, 12), 'banco', '144 parcelas de US$ 56.582')}</div></div>
        <div class="hz-linha"><b>Entrada à SPE</b><div class="hz-trilho">${bar(pos(2028, 1), pos(2038, 1), 'entrada', 'Proposta: 120× ~R$ 61 mil')}</div></div>
        <div class="hz-linha"><b>Alternativa</b><div class="hz-trilho">${bar(pos(2039, 12), pos(2042, 12), 'alt', 'Depois da dívida')}</div></div>
        <div class="hz-linha"><b>Aeronave</b><div class="hz-trilho"><div class="hz-marco" style="left:${pos(2039, 12)}">Transferida à Heli</div></div></div>
      </div>`;
    }
    if (nome === 'voo') {
      return `<div class="cena-voo"><div class="cn-k">Setembro de 2027</div>
        <div class="voo-grande">1º voo</div><div class="voo-sub">SBJR · táxi aéreo RBAC 135</div></div>`;
    }
    return '';
  }

  // ---------- resumo final ----------
  function resumo() {
    const ids = Object.keys(DEC).sort((a, b) => DEC[a].ordem.localeCompare(DEC[b].ordem));
    const pend = CAP.flatMap((c) => (c.passos || []).filter((p) => p[1] !== 'concluído').map((p) => [...p, c.titulo]));
    const colDec = ids.length
      ? `<div class="rs-col"><h3>O que decidir, na ordem</h3><ol class="rs-lista">${ids.map((id) => `<li>${encruzilhadaCurta(id)}</li>`).join('')}</ol></div>`
      : `<div class="rs-col"><h3>O que decidir</h3><p class="mudo">Nenhuma decisão em aberto por enquanto.</p></div>`;
    const colPend = pend.length ? `<div class="rs-col"><h3>O que ainda falta fazer</h3>${passos(pend.map(([t, s, q, cap]) => [t, s, [q, cap].filter(Boolean).join(' · ')]))}</div>` : '';
    const colDiv = Object.keys(DIV).length ? `<div class="rs-col"><h3>Datas para alinhar entre os materiais</h3>${Object.keys(DIV).map(divergencia).join('')}</div>` : '';
    return `<div class="resumo">${colDec}${colPend}${colDiv}</div>`;
  }

  // ---------- interação (delegada) ----------
  function atualizarSim(box) {
    const saida = box.querySelector('.sim-saida');
    if (box.dataset.sim === 'folga') {
      const MS = ['ago/27', 'set/27', 'out/27', 'nov/27', 'dez/27', 'jan/28', 'fev/28'];
      const i = +box.querySelector('input').value, folga = 4 - i;
      box.querySelector('.sim-mes').textContent = MS[i];
      saida.className = 'sim-saida ' + (folga > 1 ? 'ok' : folga >= 0 ? 'aviso' : 'ruim');
      saida.innerHTML = folga > 0
        ? `<b>${folga} ${folga === 1 ? 'mês' : 'meses'}</b> de receita antes da 1ª parcela (dez/27).`
        : folga === 0
          ? '<b>Nenhuma folga:</b> a 1ª parcela vence no mês do 1º voo.'
          : `<b>${-folga} ${-folga === 1 ? 'parcela vence' : 'parcelas vencem'} antes da receita</b>: ${-folga} × US$ 56.582 (≈ R$ ${(-folga * 325).toLocaleString('pt-BR')} mil a R$ 5,75).`;
    }
    if (box.dataset.sim === 'cambio') {
      const v = box.querySelector('button.on').dataset.v;
      saida.innerHTML = v === '5.75'
        ? '<div class="ez-nums"><div><b>≈ R$ 325 mil</b><span>por mês</span></div></div>'
        : '<div class="ez-nums"><div><b>≈ R$ 390 mil</b><span>por mês</span></div><div><b>92</b><span>meses com prejuízo</span></div><div><b>R$ 5,14 mi</b><span>de aporte</span></div></div>';
    }
  }
  function ligar(raiz = document) {
    raiz.querySelectorAll('.ez-sim').forEach(atualizarSim);
  }
  document.addEventListener('click', (e) => {
    const op = e.target.closest('.ez-op');
    if (op) {
      const ez = op.closest('.ez');
      if (!ez.querySelector('.ez-painel')) return;
      ez.querySelectorAll('.ez-op').forEach((b) => { b.classList.toggle('on', b === op); b.setAttribute('aria-selected', b === op); });
      ez.querySelectorAll('.ez-painel').forEach((p) => { p.hidden = p.dataset.p !== op.dataset.i; });
      return;
    }
    const sb = e.target.closest('.sim-botoes button');
    if (sb) { sb.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === sb)); atualizarSim(sb.closest('.ez-sim')); }
  });
  document.addEventListener('input', (e) => { const box = e.target.closest('.ez-sim'); if (box) atualizarSim(box); });
  document.addEventListener('toggle', (e) => { if (e.target.matches?.('details')) ligar(e.target); }, true);

  /** Faixa de protótipo + cabeçalho do site (aba Planejamento ativa). */
  function topo(nome) {
    document.body.insertAdjacentHTML('afterbegin', `
      <div class="proto">Protótipo ${esc(nome)} · conteúdo provisório, a confirmar · nada publicado · <a href="index.html">ver os três</a></div>
      <header class="site"><div class="site-in">
        <span class="marca"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 12h36M24 12v5"/><path d="M13 22h16a5 5 0 0 1 5 5v4H18a5 5 0 0 1-5-5v-4Z"/><path d="M34 27h6l-3 4h-3M16 31v5M13 36h8"/></svg>Heli Eagle</span>
        <nav><a href="#">Contas</a><a href="#" class="on">Planejamento</a><a href="#resumo">Decisões</a></nav>
        <span class="quem">Miguel · acesso total</span>
      </div></header>`);
  }

  window.UI = { topo, esc, datas, encruzilhada, encruzilhadaGrande, urgente, encruzilhadaCurta, divergencia, passos, cena, resumo, ligar, numeros, prazoTexto, dataBR, diasAte };
})();
