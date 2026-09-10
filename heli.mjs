#!/usr/bin/env node
/**
 * heli — prestação de contas da operação de táxi aéreo.
 *
 * O ledger em claro nunca sai de local/ (ignorado pelo git).
 * O que vai para o repositório é sempre AES-256-GCM.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { novoSalt, derivarChave, decifrar, paraObjeto, b64 } from './lib/crypto.mjs';
import {
  P, RAIZ, LEDGER_VAZIO, lerLedger, gravarLedger, lerSegredos, gravarSegredos,
  brl, parseValor, parseData, parsePct, hojeISO, proximoId,
  pergunta, senhaOculta, escolher, limparCaminho,
} from './lib/io.mjs';
import { build, mimeDe } from './lib/build.mjs';
import { montarRateio } from './lib/rateio.mjs';
import { publicar } from './lib/publicar.mjs';
import { abrirPainel } from './lib/painel.mjs';

const git = (...args) => execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' });

// ---------------------------------------------------------------- init

async function cmdInit() {
  if (fs.existsSync(P.ledger)) {
    console.log('\n  Já existe um ledger em local/ledger.json. Nada foi alterado.');
    console.log('  Para trocar as senhas:  node heli.mjs senha\n');
    return;
  }
  console.log('\n  ── Configuração inicial ────────────────────────────────\n');
  const org = await pergunta('  Nome da operação', LEDGER_VAZIO.org);

  console.log('\n  Duas senhas, dois níveis de acesso:');
  console.log('   · TOTAL   — vê fornecedor, nota fiscal, quem pagou, anexos');
  console.log('   · RESUMO  — vê apenas totais por categoria, mês e pagador\n');
  console.log('  Não há recuperação: sem a senha TOTAL os dados são irrecuperáveis.\n');

  const senhaTotal = await lerSenhaNova('  Senha TOTAL');
  const senhaResumo = await lerSenhaNova('  Senha RESUMO');
  if (senhaTotal === senhaResumo) {
    console.log('\n  As duas senhas precisam ser diferentes. Recomece.\n');
    process.exit(1);
  }

  gravarSegredos({
    senhaTotal, senhaResumo,
    saltFull: b64.from(novoSalt()),
    saltResumo: b64.from(novoSalt()),
  });
  gravarLedger({ ...LEDGER_VAZIO, org, criadoEm: new Date().toISOString() });
  fs.mkdirSync(P.nfOrig, { recursive: true });

  await build();
  console.log('\n  Falta publicar — enquanto isso o site não tem o que decifrar e a');
  console.log('  tela de senha fica travada.');
  await talvezPublicar();
  console.log('  Se a operação tem mais de um sócio bancando as despesas, defina as quotas');
  console.log('  agora — o rateio passa a ser automático:  node heli.mjs socios');
  console.log('  Depois, para lançar:  node heli.mjs add\n');
}

async function lerSenhaNova(rotulo) {
  while (true) {
    const a = await senhaOculta(rotulo);
    if (a.length < 10) { console.log('  ↳ use ao menos 10 caracteres.'); continue; }
    const b = await senhaOculta(rotulo + ' (confirme)');
    if (a !== b) { console.log('  ↳ não conferem.'); continue; }
    return a;
  }
}

// ---------------------------------------------------------------- add

async function cmdAdd() {
  const ledger = lerLedger();
  console.log('\n  ── Novo lançamento ─────────────────────────────────────');

  let data;
  while (!data) {
    data = parseData(await pergunta('\n  Data (dd/mm/aaaa)', hojeISO().split('-').reverse().join('/')));
    if (!data) console.log('  ↳ data inválida.');
  }

  const descricao = await pergunta('  Descrição');
  if (!descricao) { console.log('\n  Descrição é obrigatória. Cancelado.\n'); return; }

  const cat = await escolher('Categoria', ledger.categorias, { permitirNovo: true });
  if (cat.novo) ledger.categorias.push(cat.valor);

  const fornecedor = await pergunta('\n  Fornecedor / prestador');
  const cnpj = await pergunta('  CNPJ ou CPF (enter p/ pular)');
  const tipoDoc = await pergunta('  Tipo do documento', 'NF-e');
  const numDoc = await pergunta('  Número do documento (enter p/ pular)');

  let valor = NaN;
  while (!Number.isFinite(valor) || valor <= 0) {
    valor = parseValor(await pergunta('  Valor (R$)'));
    if (!Number.isFinite(valor) || valor <= 0) console.log('  ↳ valor inválido.');
  }

  const pag = ledger.pagadores.length
    ? await escolher('Quem pagou', ledger.pagadores, { permitirNovo: true })
    : { valor: await pergunta('\n  Quem pagou'), novo: true };
  if (pag.novo && pag.valor && !ledger.pagadores.includes(pag.valor)) ledger.pagadores.push(pag.valor);

  const forma = await escolher('Forma de pagamento', ledger.formas, { permitirNovo: true });
  if (forma.novo) ledger.formas.push(forma.valor);

  const status = (await escolher('Status', ['pago', 'a pagar', 'reembolsar'], { padrao: 'pago' })).valor;
  const rateio = await perguntarRateio(ledger, pag.valor);
  const obs = await pergunta('\n  Observação (enter p/ pular)');

  const id = proximoId(ledger, data);
  const anexos = await coletarAnexos(id);

  ledger.lancamentos.push({
    id, data, descricao, categoria: cat.valor,
    fornecedor, cnpj,
    documento: { tipo: tipoDoc, numero: numDoc },
    valor, pagador: pag.valor, forma: forma.valor, status, rateio, obs, anexos,
    registradoEm: new Date().toISOString(),
  });
  ledger.lancamentos.sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id));
  gravarLedger(ledger);

  console.log('\n  ✓ ' + id + ' · ' + descricao + ' · ' + brl(valor) + ' · pago por ' + pag.valor);
  await build();
  await talvezPublicar();
}

/**
 * Como esta despesa se divide entre os sócios.
 * null significa "pelas quotas padrão" — é o caso da esmagadora maioria, então é
 * o que sai apertando enter, e o ledger não carrega repetição desnecessária.
 */
async function perguntarRateio(ledger, pagador) {
  const socios = ledger.socios || [];
  if (!socios.length) return null;

  const quotas = socios.map((s) => `${s.nome} ${s.quota}%`).join(' · ');
  const opcao = (await escolher('Como dividir esta despesa', [
    `pelas quotas (${quotas})`,
    'percentuais só para este lançamento',
    `inteira para ${pagador} (não dividir)`,
  ], { padrao: `pelas quotas (${quotas})` })).valor;

  if (opcao.startsWith('pelas quotas')) return null;
  if (opcao.startsWith('inteira')) return [{ socio: pagador, pct: 100 }];

  while (true) {
    const custom = [];
    console.log('');
    for (const s of socios) {
      let pct = NaN;
      while (!Number.isFinite(pct)) {
        pct = parsePct(await pergunta(`  % de ${s.nome}`, String(s.quota)));
        if (!Number.isFinite(pct)) console.log('  ↳ informe um número entre 0 e 100.');
      }
      if (pct > 0) custom.push({ socio: s.nome, pct });
    }
    const soma = Math.round(custom.reduce((s, x) => s + x.pct, 0) * 100) / 100;
    if (soma === 100) return custom;
    console.log(`  ↳ soma ${soma}%, precisa dar 100%. Recomece.`);
  }
}

async function coletarAnexos(id) {
  const anexos = [];
  fs.mkdirSync(P.nfOrig, { recursive: true });
  while (true) {
    const bruto = await pergunta('\n  Anexo ' + (anexos.length + 1) + ' — caminho do PDF/foto (enter p/ encerrar)');
    if (!bruto) break;
    const origem = limparCaminho(bruto);
    if (!fs.existsSync(origem)) { console.log('  ↳ arquivo não encontrado.'); continue; }
    const base = path.basename(origem).replace(/[^\w.\-]+/g, '_');
    const arquivo = id + '-' + (anexos.length + 1) + '-' + base;
    fs.copyFileSync(origem, path.join(P.nfOrig, arquivo));
    anexos.push({
      arquivo,
      nome: path.basename(origem),
      mime: mimeDe(arquivo),
      tamanho: fs.statSync(origem).size,
    });
    console.log('  ↳ anexado: ' + path.basename(origem));
  }
  return anexos;
}

// ---------------------------------------------------------------- sócios / acerto

async function cmdSocios() {
  const ledger = lerLedger();
  console.log('\n  ── Quadro societário ───────────────────────────────────');
  if (ledger.socios?.length) {
    console.log('\n  Hoje:');
    for (const s of ledger.socios) console.log(`    ${s.nome} — ${s.quota}%`);
    console.log('\n  Definir de novo (o que você digitar substitui o quadro atual).');
  } else {
    console.log('\n  Ainda não há sócios. As quotas definem como cada despesa é dividida.');
  }

  const novos = [];
  while (true) {
    const nome = await pergunta(`\n  Sócio ${novos.length + 1} — nome (enter p/ encerrar)`);
    if (!nome) break;
    let quota = NaN;
    while (!Number.isFinite(quota)) {
      quota = parsePct(await pergunta(`  Quota de ${nome} (%)`));
      if (!Number.isFinite(quota)) console.log('  ↳ informe um número entre 0 e 100.');
    }
    novos.push({ nome, quota });
  }
  if (!novos.length) { console.log('\n  Nada alterado.\n'); return; }

  const soma = Math.round(novos.reduce((s, x) => s + x.quota, 0) * 100) / 100;
  console.log('');
  for (const s of novos) console.log(`    ${s.nome} — ${s.quota}%`);
  console.log(`    ${'─'.repeat(30)}\n    soma: ${soma}%`);
  if (soma !== 100) {
    console.log('\n  As quotas não somam 100%. O rateio ainda funciona (divide na proporção');
    console.log('  do que você informou), mas confira se é isso mesmo que você quer.');
    if ((await pergunta('  Gravar assim? (s/N)')).toLowerCase() !== 's') { console.log('  Cancelado.\n'); return; }
  }

  ledger.socios = novos;
  for (const s of novos) if (!ledger.pagadores.includes(s.nome)) ledger.pagadores.push(s.nome);
  gravarLedger(ledger);
  console.log('\n  ✓ quadro societário gravado.');
  await build();
  mostrarAcerto(lerLedger());
  await talvezPublicar();
}

function mostrarAcerto(ledger) {
  const r = montarRateio(ledger);
  if (!r) {
    console.log('\n  Sem quadro societário. Configure com:  node heli.mjs socios\n');
    return;
  }
  console.log('\n  ── Acerto de contas ────────────────────────────────────\n');
  console.log(`  Base rateada: ${brl(r.baseDesembolsada)} em ${r.qtdDesembolsados} lançamento(s) desembolsado(s).`);
  if (r.emAberto) console.log(`  Fora da conta: ${brl(r.emAberto)} ainda a pagar.`);
  console.log('');
  console.log('   ' + 'SÓCIO'.padEnd(22) + 'QUOTA'.padStart(7) + 'PAGOU'.padStart(16) + 'CABIA'.padStart(16) + 'SALDO'.padStart(16));
  for (const p of r.posicoes) {
    const sinal = p.saldo > 0 ? '+' : '';
    console.log('   ' + (p.socio + (p.externo ? ' *' : '')).padEnd(22) +
      (p.quota + '%').padStart(7) + brl(p.pago).padStart(16) +
      brl(p.devido).padStart(16) + (sinal + brl(p.saldo)).padStart(16));
  }
  if (r.posicoes.some((p) => p.externo)) {
    console.log('\n   * pagou mas não é sócio — o valor inteiro é crédito a receber.');
  }

  console.log('\n  Para zerar:');
  if (!r.acertos.length) console.log('    nada a acertar — as contas estão equilibradas.');
  for (const a of r.acertos) console.log(`    ${a.de}  →  ${a.para}   ${brl(a.valor)}`);
  console.log('');
}

// ---------------------------------------------------------------- list / rm

function cmdList() {
  const ledger = lerLedger();
  if (!ledger.lancamentos.length) { console.log('\n  Nenhum lançamento ainda.\n'); return; }
  console.log('');
  let total = 0;
  for (const l of ledger.lancamentos) {
    total += l.valor;
    const dt = l.data.split('-').reverse().join('/');
    const clipe = l.anexos && l.anexos.length ? '  [' + l.anexos.length + ' anexo(s)]' : '';
    const st = l.status === 'pago' ? '' : '  «' + l.status + '»';
    console.log('  ' + l.id + '  ' + dt + '  ' + brl(l.valor).padStart(16) + '  ' + l.descricao);
    console.log('  ' + ' '.repeat(9) + '  ' + l.categoria + ' · ' + (l.fornecedor || 's/ fornecedor') + ' · pago por ' + l.pagador + clipe + st);
  }
  console.log('\n  ' + ledger.lancamentos.length + ' lançamentos · total ' + brl(total) + '\n');
}

async function cmdRm(id) {
  const ledger = lerLedger();
  const i = ledger.lancamentos.findIndex((l) => l.id === id);
  if (i < 0) { console.log('\n  Lançamento ' + id + ' não encontrado.\n'); return; }
  const l = ledger.lancamentos[i];
  console.log('\n  ' + l.id + ' · ' + l.data + ' · ' + l.descricao + ' · ' + brl(l.valor));
  if ((await pergunta('  Remover? (s/N)')).toLowerCase() !== 's') { console.log('  Cancelado.\n'); return; }
  for (const a of l.anexos || []) {
    const f = path.join(P.nfOrig, a.arquivo);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  ledger.lancamentos.splice(i, 1);
  gravarLedger(ledger);
  console.log('  ✓ removido.');
  await build();
  await talvezPublicar();
}

// ---------------------------------------------------------------- senha / restore

async function cmdSenha() {
  const seg = lerSegredos();
  if (!seg) { console.log('\n  Rode primeiro:  node heli.mjs init\n'); return; }
  const qual = (await escolher('Qual senha trocar', ['TOTAL', 'RESUMO'])).valor;
  const nova = await lerSenhaNova('  Nova senha ' + qual);
  if (qual === 'TOTAL') { seg.senhaTotal = nova; seg.saltFull = b64.from(novoSalt()); }
  else { seg.senhaResumo = nova; seg.saltResumo = b64.from(novoSalt()); }
  gravarSegredos(seg);
  // salt novo invalida os anexos já cifrados: recifra tudo
  if (qual === 'TOTAL' && fs.existsSync(P.nfEnc)) {
    for (const f of fs.readdirSync(P.nfEnc)) fs.unlinkSync(path.join(P.nfEnc, f));
  }
  await build();
  console.log('\n  ✓ senha trocada — só vale no site depois de publicar.');
  await talvezPublicar();
}

async function cmdRestore() {
  // Reconstrói local/ledger.json a partir do que está publicado — resgate se o PC for perdido.
  const meta = JSON.parse(fs.readFileSync(path.join(P.dados, 'meta.json'), 'utf8'));
  const senha = await senhaOculta('  Senha TOTAL');
  const chave = await derivarChave(senha, b64.to(meta.saltTotal));
  let ledger;
  try {
    const env = JSON.parse(fs.readFileSync(path.join(P.dados, 'ledger.enc'), 'utf8'));
    ledger = paraObjeto(await decifrar(chave, env));
  } catch {
    console.log('\n  Senha incorreta.\n');
    process.exit(1);
  }
  fs.mkdirSync(P.nfOrig, { recursive: true });
  for (const l of ledger.lancamentos) {
    for (const a of l.anexos || []) {
      const src = path.join(P.nfEnc, a.arquivo + '.enc');
      if (!fs.existsSync(src)) continue;
      const bytes = await decifrar(chave, JSON.parse(fs.readFileSync(src, 'utf8')));
      fs.writeFileSync(path.join(P.nfOrig, a.arquivo), bytes);
    }
  }
  delete ledger.escopo;
  delete ledger.geradoEm;
  gravarLedger(ledger);
  console.log('\n  ✓ restaurados ' + ledger.lancamentos.length + ' lançamentos e seus anexos em local/.');
  console.log('  Falta só recriar local/segredos.json — rode:  node heli.mjs senha\n');
}

// ---------------------------------------------------------------- publish

async function talvezPublicar() {
  const r = await pergunta('\n  Publicar agora no site? (S/n)', 'S');
  if (r.toLowerCase() === 's') await cmdPublish();
  else console.log('  Publique depois com:  node heli.mjs publish\n');
}

async function cmdPublish() {
  const r = await publicar();
  console.log('\n  ' + (r.ok ? (r.novidade ? '✓ ' : '') : 'Falha ao publicar: ') + r.mensagem + '\n');
}

// ---------------------------------------------------------------- painel

async function cmdPainel() {
  const porta = Number(process.argv[3]) || undefined;
  await abrirPainel(porta ? { porta } : {});
  // o processo segue vivo servindo o painel até Ctrl+C ou "Fechar" na página
}

// ---------------------------------------------------------------- roteador

const AJUDA = `
  heli — prestação de contas

    node heli.mjs painel     abre o painel no navegador  ← o jeito fácil
    node heli.mjs init       configuração inicial (senhas + ledger)
    node heli.mjs socios     define os sócios e suas quotas
    node heli.mjs add        registra um lançamento pelo terminal
    node heli.mjs list       lista os lançamentos no terminal
    node heli.mjs acerto     quem deve a quem, e quanto
    node heli.mjs rm <id>    remove um lançamento
    node heli.mjs build      recifra docs/data/ sem publicar
    node heli.mjs publish    build + commit + push
    node heli.mjs senha      troca a senha TOTAL ou RESUMO
    node heli.mjs restore    reconstrói o ledger local a partir do publicado
`;

const cmd = process.argv[2];
const rotas = {
  init: cmdInit, painel: cmdPainel, ui: cmdPainel,
  add: cmdAdd, novo: cmdAdd, list: cmdList, ls: cmdList,
  socios: cmdSocios, acerto: () => mostrarAcerto(lerLedger()),
  rm: () => cmdRm(process.argv[3]), build, publish: cmdPublish, senha: cmdSenha, restore: cmdRestore,
};

try {
  if (!cmd || cmd === 'ajuda' || cmd === '--help' || cmd === '-h') console.log(AJUDA);
  else if (rotas[cmd]) await rotas[cmd]();
  else {
    console.log('\n  Comando desconhecido: ' + cmd);
    console.log(AJUDA);
    process.exit(1);
  }
} catch (e) {
  console.error('\n  x ' + e.message + '\n');
  process.exit(1);
}
