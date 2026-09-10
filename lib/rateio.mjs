/**
 * Rateio entre sócios e acerto de contas.
 *
 * Cada lançamento foi desembolsado por uma pessoa (o pagador), mas a despesa
 * pertence a todos conforme as quotas societárias. A diferença entre o que cada
 * um pagou e o que cabia a cada um define credores e devedores.
 *
 * Só entram lançamentos já desembolsados. O que está "a pagar" ainda não saiu do
 * bolso de ninguém e não gera acerto — aparece à parte, como compromisso futuro.
 *
 * Todo o cálculo roda em centavos inteiros para que as parcelas fechem exatamente
 * com o total, sem centavo sobrando nem faltando.
 */

const cent = (reais) => Math.round(reais * 100);
const real = (centavos) => centavos / 100;

export const DESEMBOLSADO = (l) => l.status !== 'a pagar';

/**
 * Divide um valor em centavos entre participantes, pelo método do maior resto:
 * cada um leva o piso da sua parte e os centavos restantes vão para quem ficou
 * com a maior fração descartada. A soma das parcelas é sempre o valor original.
 */
export function dividir(valorCent, participacoes) {
  const soma = participacoes.reduce((s, p) => s + p.pct, 0);
  if (!participacoes.length || soma <= 0) return [];

  const partes = participacoes.map((p) => {
    const exato = (valorCent * p.pct) / soma;
    const piso = Math.floor(exato);
    return { nome: p.nome, cent: piso, resto: exato - piso };
  });

  let sobra = valorCent - partes.reduce((s, p) => s + p.cent, 0);
  const ordem = [...partes].sort((a, b) => b.resto - a.resto || a.nome.localeCompare(b.nome));
  for (let i = 0; sobra > 0; i++, sobra--) ordem[i % ordem.length].cent += 1;

  return partes.map(({ nome, cent }) => ({ nome, cent }));
}

/** A participação que vale para um lançamento: a específica dele, ou as quotas padrão. */
export function participacoesDe(lanc, socios) {
  if (Array.isArray(lanc.rateio) && lanc.rateio.length) {
    return lanc.rateio.map((r) => ({ nome: r.socio, pct: r.pct }));
  }
  return socios.map((s) => ({ nome: s.nome, pct: s.quota }));
}

/** Transferências que zeram os saldos, sempre em no máximo (n-1) movimentos. */
export function acertos(posicoes) {
  const credores = posicoes.filter((p) => p.saldoCent > 0)
    .map((p) => ({ nome: p.socio, resta: p.saldoCent }))
    .sort((a, b) => b.resta - a.resta || a.nome.localeCompare(b.nome));
  const devedores = posicoes.filter((p) => p.saldoCent < 0)
    .map((p) => ({ nome: p.socio, resta: -p.saldoCent }))
    .sort((a, b) => b.resta - a.resta || a.nome.localeCompare(b.nome));

  const lista = [];
  let i = 0, j = 0;
  while (i < devedores.length && j < credores.length) {
    const v = Math.min(devedores[i].resta, credores[j].resta);
    if (v > 0) lista.push({ de: devedores[i].nome, para: credores[j].nome, valor: real(v) });
    devedores[i].resta -= v;
    credores[j].resta -= v;
    if (devedores[i].resta === 0) i++;
    if (credores[j].resta === 0) j++;
  }
  return lista;
}

/**
 * Posição de cada sócio e o acerto sugerido.
 * Devolve null quando ainda não há quadro societário configurado.
 */
export function montarRateio(ledger) {
  const socios = ledger.socios || [];
  if (!socios.length) return null;

  const desembolsados = ledger.lancamentos.filter(DESEMBOLSADO);
  const emAbertoCent = ledger.lancamentos
    .filter((l) => !DESEMBOLSADO(l))
    .reduce((s, l) => s + cent(l.valor), 0);

  // Quem aparece na conta: os sócios, mais qualquer pagador de fora que tenha
  // adiantado dinheiro (esse entra com quota zero, portanto como credor puro).
  const nomes = new Set(socios.map((s) => s.nome));
  for (const l of desembolsados) nomes.add(l.pagador);

  const pago = new Map([...nomes].map((n) => [n, 0]));
  const devido = new Map([...nomes].map((n) => [n, 0]));
  let semRateioCent = 0;

  for (const l of desembolsados) {
    const vc = cent(l.valor);
    pago.set(l.pagador, (pago.get(l.pagador) || 0) + vc);

    const partes = dividir(vc, participacoesDe(l, socios));
    if (!partes.length) { semRateioCent += vc; continue; }
    for (const p of partes) devido.set(p.nome, (devido.get(p.nome) || 0) + p.cent);
  }

  const posicoes = [...nomes].map((nome) => {
    const s = socios.find((x) => x.nome === nome);
    const pagoCent = pago.get(nome) || 0;
    const devidoCent = devido.get(nome) || 0;
    return {
      socio: nome,
      quota: s ? s.quota : 0,
      externo: !s,
      pago: real(pagoCent),
      devido: real(devidoCent),
      saldo: real(pagoCent - devidoCent),
      saldoCent: pagoCent - devidoCent,
    };
  }).sort((a, b) => b.saldo - a.saldo);

  const baseCent = desembolsados.reduce((s, l) => s + cent(l.valor), 0);

  return {
    socios,
    quotasSomam: socios.reduce((s, x) => s + x.quota, 0),
    baseDesembolsada: real(baseCent),
    emAberto: real(emAbertoCent),
    semRateio: real(semRateioCent),
    qtdDesembolsados: desembolsados.length,
    posicoes: posicoes.map(({ saldoCent, ...p }) => p),
    acertos: acertos(posicoes),
  };
}
