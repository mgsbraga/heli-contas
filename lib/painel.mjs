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
import { P, RAIZ, lerLedger, gravarLedger, parseValor, parseData, proximoId } from './io.mjs';
import { build, mimeDe } from './build.mjs';
import { publicar, pendencias } from './publicar.mjs';
import { montarRateio } from './rateio.mjs';
import { lerNota } from './nfe.mjs';

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

  if (Array.isArray(d.rateio) && d.rateio.length) {
    const soma = Math.round(d.rateio.reduce((s, r) => s + Number(r.pct || 0), 0) * 100) / 100;
    if (soma !== 100) erros.push(`Os percentuais do rateio somam ${soma}%, precisam somar 100%.`);
  }
  return { erros, data, valor };
}

/** Grava os anexos novos em local/nf/ e devolve a lista final do lançamento. */
function gravarAnexos(id, anexos) {
  fs.mkdirSync(P.nfOrig, { recursive: true });
  const finais = [];
  let n = 0;
  for (const a of anexos || []) {
    n++;
    if (a.arquivo && !a.dataB64) { finais.push(a); continue; }   // já estava salvo
    const base = String(a.nome || 'anexo').replace(/[^\w.\-]+/g, '_');
    const arquivo = `${id}-${n}-${base}`;
    const bytes = Buffer.from(a.dataB64, 'base64');
    fs.writeFileSync(path.join(P.nfOrig, arquivo), bytes);
    finais.push({ arquivo, nome: a.nome || base, mime: a.mime || mimeDe(arquivo), tamanho: bytes.length });
  }
  return finais;
}

function apagarAnexosOrfaos(antigos, novos) {
  const mantidos = new Set((novos || []).map((a) => a.arquivo));
  for (const a of antigos || []) {
    if (mantidos.has(a.arquivo)) continue;
    const f = path.join(P.nfOrig, a.arquivo);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

async function salvarLancamento(d) {
  const ledger = lerLedger();
  const { erros, data, valor } = validar(d);
  if (erros.length) return { ok: false, erros };

  // categoria, pagador e forma podem vir digitados na hora
  for (const [lista, v] of [[ledger.categorias, d.categoria], [ledger.pagadores, d.pagador], [ledger.formas, d.forma]]) {
    if (v && !lista.includes(v)) lista.push(v);
  }

  const existente = d.id ? ledger.lancamentos.find((l) => l.id === d.id) : null;
  const id = existente ? existente.id : proximoId(ledger, data);
  const anexos = gravarAnexos(id, d.anexos);
  if (existente) apagarAnexosOrfaos(existente.anexos, anexos);

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
    registradoEm: existente?.registradoEm || new Date().toISOString(),
  };

  if (existente) ledger.lancamentos[ledger.lancamentos.indexOf(existente)] = lanc;
  else ledger.lancamentos.push(lanc);

  ledger.lancamentos.sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id));
  gravarLedger(ledger);
  await build({ verboso: false });
  return { ok: true, id, editado: !!existente };
}

async function apagarLancamento(id) {
  const ledger = lerLedger();
  const i = ledger.lancamentos.findIndex((l) => l.id === id);
  if (i < 0) return { ok: false, erros: ['Lançamento não encontrado.'] };
  apagarAnexosOrfaos(ledger.lancamentos[i].anexos, []);
  ledger.lancamentos.splice(i, 1);
  gravarLedger(ledger);
  await build({ verboso: false });
  return { ok: true };
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
    .some((l) => (l.anexos || []).some((a) => a.arquivo === arquivo));
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
      if (rota === '/api/lancamento') return json(res, 200, await salvarLancamento(corpo));
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
