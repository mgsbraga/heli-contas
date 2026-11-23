/**
 * Painel local de lançamentos.
 *
 * Sobe um servidor que só escuta em 127.0.0.1 e serve uma página com formulário.
 * Os dados em claro nunca saem da máquina: o navegador fala com este processo,
 * que grava em local/ e publica cifrado, exatamente como o CLI faz.
 *
 * Duas travas, porque a página manipula o ledger inteiro sem senha:
 *  - a porta só aceita conexão da própria máquina (loopback);
 *  - toda chamada exige um token sorteado a cada execução, que só quem abriu o
 *    painel conhece. Sem ele, uma página maliciosa aberta no mesmo navegador
 *    poderia conversar com este servidor.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { P, RAIZ, lerLedger, gravarLedger, parseValor, parseData, proximoId, anexosDe, STATUS } from './io.mjs';
import { build, mimeDe } from './build.mjs';
import { publicar, pendencias } from './publicar.mjs';
import { montarRateio } from './rateio.mjs';
import { lerNota } from './nfe.mjs';
import { listarEntrada, definirPastaEntrada, lerArquivoEntrada, arquivarEntrada, pastaEntrada } from './entrada.mjs';
import { listarEnvios, baixarEnvio, apagarEnvio, configuracaoEnvio, configurarEnvio, linkPublico } from './envio.mjs';

const PORTA_PADRAO = 7788;
const LIMITE_CORPO = 40 * 1024 * 1024;   // 40 MB por requisição

const token = () => [...crypto.getRandomValues(new Uint8Array(24))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

function lerCorpo(req) {
  return new Promise((res, rej) => {
    const partes = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > LIMITE_CORPO) { rej(new Error('Requisição grande demais.')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      try { res(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {}); }
      catch { rej(new Error('Corpo inválido.')); }
    });
    req.on('error', rej);
  });
}

const json = (res, codigo, corpo) => {
  const txt = JSON.stringify(corpo);
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(txt);
};

// ---------------------------------------------------------------- operações

function estado() {
  const ledger = lerLedger();
  return {
    org: ledger.org,
    categorias: ledger.categorias,
    formas: ledger.formas,
    pagadores: ledger.pagadores,
    socios: ledger.socios || [],
    lancamentos: ledger.lancamentos,
    rateio: montarRateio(ledger),
    pendencias: pendencias(),
    pastaEntrada: pastaEntrada(),
    envio: { ...configuracaoEnvio(), link: linkPublico() },
  };
}

function validar(d) {
  const erros = [];
  const data = parseData(d.data || '');
  if (!data) erros.push('Data inválida.');
  if (!String(d.descricao || '').trim()) erros.push('A descrição é obrigatória.');
  const valor = parseValor(d.valor);
  if (!Number.isFinite(valor) || valor <= 0) erros.push('Valor inválido.');
  if (!String(d.categoria || '').trim()) erros.push('Escolha uma categoria.');
  if (!String(d.pagador || '').trim()) erros.push('Informe quem pagou.');
  if (d.status && !STATUS.includes(d.status)) erros.push('Status inválido.');

  let reembolso = null;
  if (d.status === 'reembolsado') {
    reembolso = validarReembolso(d.reembolso, erros);
    if (reembolso && reembolso.por === String(d.pagador || '').trim()) {
      erros.push('Quem reembolsou não pode ser o próprio pagador.');
    }
  }

  if (Array.isArray(d.rateio) && d.rateio.length) {
    const soma = Math.round(d.rateio.reduce((s, r) => s + Number(r.pct || 0), 0) * 100) / 100;
    if (soma !== 100) erros.push(`Os percentuais do rateio somam ${soma}%, precisam somar 100%.`);
  }
  return { erros, data, valor, reembolso };
}

function validarReembolso(r, erros) {
  const por = String(r?.por || '').trim();
  const data = parseData(r?.data || '');
  if (!por) erros.push('Informe quem fez o reembolso.');
  if (!data) erros.push('Informe a data do reembolso.');
  return por && data ? { por, data, comprovantes: r?.comprovantes || [] } : null;
}

/** Grava os anexos novos em local/nf/ e devolve a lista final do lançamento. */
function gravarAnexos(id, anexos, prefixo = '') {
  fs.mkdirSync(P.nfOrig, { recursive: true });
  const finais = [];
  let n = 0;
  for (const a of anexos || []) {
    n++;
    if (a.arquivo && !a.dataB64) { finais.push(a); continue; }   // já estava salvo
    const base = String(a.nome || 'anexo').replace(/[^\w.\-]+/g, '_');
    let arquivo = `${id}-${prefixo}${n}-${base}`;
    // nunca sobrescreve: o nome pode já pertencer a outro anexo (inclusive de outro lançamento)
    if (fs.existsSync(path.join(P.nfOrig, arquivo))) arquivo = `${id}-${prefixo}${n}-${Date.now().toString(36)}-${base}`;
    const bytes = Buffer.from(a.dataB64, 'base64');
    fs.writeFileSync(path.join(P.nfOrig, arquivo), bytes);
    finais.push({ arquivo, nome: a.nome || base, mime: a.mime || mimeDe(arquivo), tamanho: bytes.length });
  }
  return finais;
}

/** Apaga, dentre os candidatos, os arquivos que nenhum lançamento do ledger usa mais. */
function apagarSemReferencia(candidatos, ledger) {
  const usados = new Set(ledger.lancamentos.flatMap((l) => anexosDe(l).map((a) => a.arquivo)));
  for (const a of candidatos || []) {
    if (!a?.arquivo || usados.has(a.arquivo)) continue;
    const f = path.join(P.nfOrig, path.basename(a.arquivo));
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

const lembrarPagador = (ledger, nome) => {
  if (nome && !ledger.pagadores.includes(nome)) ledger.pagadores.push(nome);
};

async function salvarLancamento(d) {
  const ledger = lerLedger();
  const { erros, data, valor, reembolso } = validar(d);
  if (erros.length) return { ok: false, erros };

  // categoria, pagador e forma podem vir digitados na hora
  for (const [lista, v] of [[ledger.categorias, d.categoria], [ledger.pagadores, d.pagador], [ledger.formas, d.forma]]) {
    if (v && !lista.includes(v)) lista.push(v);
  }

  const existente = d.id ? ledger.lancamentos.find((l) => l.id === d.id) : null;
  const id = existente ? existente.id : proximoId(ledger, data);
  const anexos = gravarAnexos(id, d.anexos);
  if (reembolso) {
    reembolso.comprovantes = gravarAnexos(id, reembolso.comprovantes, 'R');
    lembrarPagador(ledger, reembolso.por);
  }

  const lanc = {
    id,
    data,
    descricao: String(d.descricao).trim(),
    categoria: d.categoria,
    fornecedor: String(d.fornecedor || '').trim(),
    cnpj: String(d.cnpj || '').trim(),
    documento: {
      tipo: String(d.tipoDoc || '').trim(),
      numero: String(d.numDoc || '').trim(),
      chave: String(d.chave || '').replace(/\D/g, ''),
    },
    valor,
    pagador: d.pagador,
    forma: d.forma || '',
    status: d.status || 'pago',
    rateio: Array.isArray(d.rateio) && d.rateio.length ? d.rateio : null,
    obs: String(d.obs || '').trim(),
    anexos,
    ...(reembolso ? { reembolso } : {}),
    registradoEm: existente?.registradoEm || new Date().toISOString(),
  };

  if (existente) ledger.lancamentos[ledger.lancamentos.indexOf(existente)] = lanc;
  else ledger.lancamentos.push(lanc);
  if (existente) apagarSemReferencia(anexosDe(existente), ledger);

  ledger.lancamentos.sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id));
  gravarLedger(ledger);
  await build({ verboso: false });
  return { ok: true, id, editado: !!existente };
}

async function apagarLancamento(id) {
  const ledger = lerLedger();
  const i = ledger.lancamentos.findIndex((l) => l.id === id);
  if (i < 0) return { ok: false, erros: ['Lançamento não encontrado.'] };
  const [fora] = ledger.lancamentos.splice(i, 1);
  apagarSemReferencia(anexosDe(fora), ledger);
  gravarLedger(ledger);
  await build({ verboso: false });
  return { ok: true };
}

/**
 * Marca vários lançamentos como reembolsados de uma vez. Os comprovantes são
 * gravados uma vez só e referenciados por todos (um PIX pode cobrir várias notas).
 */
async function marcarReembolsados(d) {
  const ledger = lerLedger();
  const erros = [];
  const ids = [...new Set(Array.isArray(d.ids) ? d.ids : [])];
  const alvos = ids.map((id) => ledger.lancamentos.find((l) => l.id === id));
  if (!ids.length) erros.push('Selecione ao menos um lançamento.');
  if (alvos.some((l) => !l)) erros.push('Algum lançamento selecionado não existe mais. Recarregue o painel.');
  const r = validarReembolso(d, erros);
  for (const l of alvos.filter(Boolean)) {
    if (l.status === 'a pagar') erros.push(`${l.id} ainda está "a pagar": não há o que reembolsar.`);
    if (r && l.pagador === r.por) erros.push(`${l.id}: quem reembolsou é o próprio pagador.`);
  }
  if (erros.length) return { ok: false, erros };

  const comprovantes = gravarAnexos(ids[0], r.comprovantes, 'R');
  const antigos = [];
  for (const l of alvos) {
    antigos.push(...(l.reembolso?.comprovantes || []));
    l.status = 'reembolsado';
    l.reembolso = { por: r.por, data: r.data, comprovantes: comprovantes.map((a) => ({ ...a })) };
  }
  lembrarPagador(ledger, r.por);
  apagarSemReferencia(antigos, ledger);
  gravarLedger(ledger);
  await build({ verboso: false });
  return { ok: true, qtd: alvos.length };
}

async function salvarSocios(socios) {
  const limpos = (socios || [])
    .map((s) => ({ nome: String(s.nome || '').trim(), quota: Number(s.quota) }))
    .filter((s) => s.nome && Number.isFinite(s.quota) && s.quota >= 0);
  const ledger = lerLedger();
  ledger.socios = limpos;
  for (const s of limpos) if (!ledger.pagadores.includes(s.nome)) ledger.pagadores.push(s.nome);
  gravarLedger(ledger);
  await build({ verboso: false });
  return { ok: true, soma: Math.round(limpos.reduce((a, s) => a + s.quota, 0) * 100) / 100 };
}

function lerAnexo(arquivo) {
  // só serve o que está referenciado no ledger — nada de caminho arbitrário
  const referenciado = lerLedger().lancamentos
    .some((l) => anexosDe(l).some((a) => a.arquivo === arquivo));
  if (!referenciado) return null;
  const f = path.join(P.nfOrig, path.basename(arquivo));
  return fs.existsSync(f) ? f : null;
}

// ---------------------------------------------------------------- servidor

export function abrirPainel({ porta = PORTA_PADRAO, abrirNavegador = true } = {}) {
  if (!fs.existsSync(P.ledger)) {
    throw new Error('Ledger local não encontrado. Rode primeiro:  node heli.mjs init');
  }
  const chave = token();
  const paginaPainel = path.join(RAIZ, 'painel', 'index.html');
  if (!fs.existsSync(paginaPainel)) throw new Error('painel/index.html nao encontrado.');

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const rota = url.pathname;

    // Só conversa com a própria máquina, e só com quem tem o token desta execução.
    const host = (req.headers.host || '').split(':')[0];
    if (host !== '127.0.0.1' && host !== 'localhost') return json(res, 403, { erro: 'Acesso local apenas.' });

    if (rota === '/') {
      if (url.searchParams.get('k') !== chave) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('Link inválido. Abra o painel com: node heli.mjs painel');
      }
      // relido a cada carga: ajustes na pagina valem sem reiniciar o painel
      const html = fs.readFileSync(paginaPainel, 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html.replace('__TOKEN__', chave));
    }

    // o decodificador de QR e um arquivo estatico da propria pasta do painel
    if (rota.startsWith('/vendor/') && req.method === 'GET') {
      const arq = path.join(RAIZ, 'painel', 'vendor', path.basename(rota));
      if (!/\.js$/.test(arq) || !fs.existsSync(arq)) return json(res, 404, { erro: 'nao encontrado' });
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return fs.createReadStream(arq).pipe(res);
    }

    const autorizado = req.headers['x-heli-token'] === chave || url.searchParams.get('k') === chave;
    if (!autorizado) return json(res, 403, { erro: 'Token inválido.' });

    try {
      if (rota === '/api/estado' && req.method === 'GET') return json(res, 200, estado());
      if (rota === '/api/entrada' && req.method === 'GET') return json(res, 200, listarEntrada());
      if (rota === '/api/envios' && req.method === 'GET') return json(res, 200, await listarEnvios());

      if (rota === '/api/entrada/arquivo' && req.method === 'GET') {
        const a = lerArquivoEntrada(url.searchParams.get('nome') || '');
        if (!a) return json(res, 404, { erro: 'Arquivo não encontrado.' });
        res.writeHead(200, { 'content-type': mimeDe(a.caminho), 'cache-control': 'no-store' });
        return res.end(a.bytes);
      }

      if (rota === '/api/anexo' && req.method === 'GET') {
        const f = lerAnexo(url.searchParams.get('arquivo') || '');
        if (!f) return json(res, 404, { erro: 'Anexo não encontrado.' });
        res.writeHead(200, { 'content-type': mimeDe(f), 'cache-control': 'no-store' });
        return fs.createReadStream(f).pipe(res);
      }

      if (req.method !== 'POST') return json(res, 404, { erro: 'Rota desconhecida.' });
      const corpo = await lerCorpo(req);

      if (rota === '/api/lerNota') {
        const bytes = corpo.dataB64 ? Buffer.from(corpo.dataB64, 'base64') : null;
        return json(res, 200, lerNota({
          nome: corpo.nome || '', mime: corpo.mime || '',
          bytes, chaveManual: corpo.chave || '',
        }));
      }
      if (rota === '/api/entrada/pasta') return json(res, 200, definirPastaEntrada(corpo.pasta));
      if (rota === '/api/entrada/arquivar') {
        return json(res, 200, arquivarEntrada(corpo.nome, corpo.destino));
      }
      if (rota === '/api/envio/abrir') {
        try {
          const conteudo = await baixarEnvio(corpo.chave);
          return json(res, 200, { ok: true, ...conteudo });
        } catch (e) {
          return json(res, 200, { ok: false, erro: e.message });
        }
      }
      if (rota === '/api/envio/apagar') {
        try { return json(res, 200, await apagarEnvio(corpo.chave)); }
        catch (e) { return json(res, 200, { ok: false, erro: e.message }); }
      }
      if (rota === '/api/envio/config') return json(res, 200, configurarEnvio(corpo));
      if (rota === '/api/lancamento') return json(res, 200, await salvarLancamento(corpo));
      if (rota === '/api/reembolso') return json(res, 200, await marcarReembolsados(corpo));
      if (rota === '/api/apagar') return json(res, 200, await apagarLancamento(corpo.id));
      if (rota === '/api/socios') return json(res, 200, await salvarSocios(corpo.socios));
      if (rota === '/api/publicar') return json(res, 200, await publicar());
      if (rota === '/api/encerrar') {
        json(res, 200, { ok: true });
        setTimeout(() => process.exit(0), 200);
        return;
      }
      return json(res, 404, { erro: 'Rota desconhecida.' });
    } catch (e) {
      return json(res, 500, { ok: false, erros: [e.message] });
    }
  });

  return new Promise((resolve, reject) => {
    servidor.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        reject(new Error(`A porta ${porta} já está em uso. Feche o outro painel ou rode:  node heli.mjs painel ${porta + 1}`));
      } else reject(e);
    });
    servidor.listen(porta, '127.0.0.1', () => {
      const endereco = `http://127.0.0.1:${porta}/?k=${chave}`;
      console.log('\n  Painel aberto em:');
      console.log(`  ${endereco}\n`);
      console.log('  Deixe esta janela aberta enquanto usa o painel.');
      console.log('  Para encerrar: feche o painel no navegador ou aperte Ctrl+C aqui.\n');
      if (abrirNavegador) spawn('cmd', ['/c', 'start', '""', endereco], { detached: true, stdio: 'ignore' }).unref();
      resolve(servidor);
    });
  });
}
