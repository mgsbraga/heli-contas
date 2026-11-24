#!/usr/bin/env node
/**
 * heli — prestação de contas da operação de táxi aéreo.
 *
 * O ledger em claro nunca sai de local/ (ignorado pelo git).
 * O que vai para o repositório é sempre AES-256-GCM.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { derivarBits, importarChave, decifrar, paraObjeto, b64, idDoLogin } from './lib/crypto.mjs';
import {
  garantirChaves, criarUsuario, validarNovoUsuario, trocarSenha, removerUsuario, listarUsuarios, normalizarLogin, NIVEIS,
} from './lib/usuarios.mjs';
import {
  P, RAIZ, LEDGER_VAZIO, lerLedger, gravarLedger, lerSegredos, gravarSegredos,
  brl, parseValor, parseData, parsePct, hojeISO, proximoId,
  pergunta, senhaOculta, escolher, limparCaminho, anexosDe,
} from './lib/io.mjs';
import { build, mimeDe } from './lib/build.mjs';
import { montarRateio } from './lib/rateio.mjs';
import { publicar } from './lib/publicar.mjs';
import { abrirPainel } from './lib/painel.mjs';
import { montarWorker, configurarEnvio, configuracaoEnvio, linkPublico } from './lib/envio.mjs';

const git = (...args) => execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' });

// ---------------------------------------------------------------- init

async function cmdInit() {
  if (fs.existsSync(P.ledger)) {
    console.log('\n  Já existe um ledger em local/ledger.json. Nada foi alterado.');
    console.log('  Para gerenciar acessos:  node heli.mjs usuario\n');
    return;
  }
  console.log('\n  ── Configuração inicial ────────────────────────────────\n');
  const org = await pergunta('  Nome da operação', LEDGER_VAZIO.org);

  console.log('\n  O site abre com login e senha, um por pessoa. Comece pelo seu.');
  console.log('  Dois níveis: total (tudo, inclusive notas) e resumo (só totais).\n');
  let login = '';
  while (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(login)) login = normalizarLogin(await pergunta('  Seu login (ex.: miguel)'));
  const nome = await pergunta('  Seu nome', login);

  const senha = await lerSenhaNova('  Sua senha');
  const seg = garantirChaves(lerSegredos() || {});
  await criarUsuario(seg, login, nome, 'total', senha);
  gravarSegredos(seg);
  gravarLedger({ ...LEDGER_VAZIO, org, criadoEm: new Date().toISOString() });
  fs.mkdirSync(P.nfOrig, { recursive: true });

  await build();
  console.log('\n  Falta publicar — enquanto isso o site não tem o que decifrar e a');
  console.log('  tela de login fica travada.');
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

  const status = (await escolher('Status', ['pago', 'a pagar', 'reembolsar', 'reembolsado'], { padrao: 'pago' })).valor;
  let reembolsoDados = null;
  if (status === 'reembolsado') {
    let por = '';
    while (!por || por === pag.valor) {
      por = (await escolher('Quem reembolsou', ledger.pagadores, { permitirNovo: true })).valor;
      if (por === pag.valor) console.log('  ↳ quem reembolsou não pode ser o próprio pagador.');
    }
    if (!ledger.pagadores.includes(por)) ledger.pagadores.push(por);
    let dataR = null;
    while (!dataR) {
      dataR = parseData(await pergunta('  Data do reembolso (dd/mm/aaaa)', hojeISO().split('-').reverse().join('/')));
      if (!dataR) console.log('  ↳ data inválida.');
    }
    reembolsoDados = { por, data: dataR };
  }
  const rateio = await perguntarRateio(ledger, pag.valor);
  const obs = await pergunta('\n  Observação (enter p/ pular)');

  const id = proximoId(ledger, data);
  const anexos = await coletarAnexos(id);
  const reembolso = reembolsoDados
    ? { ...reembolsoDados, comprovantes: await coletarAnexos(id, { prefixo: 'R', rotulo: 'Comprovante do reembolso' }) }
    : null;

  ledger.lancamentos.push({
    id, data, descricao, categoria: cat.valor,
    fornecedor, cnpj,
    documento: { tipo: tipoDoc, numero: numDoc },
    valor, pagador: pag.valor, forma: forma.valor, status, rateio, obs, anexos,
    ...(reembolso ? { reembolso } : {}),
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

async function coletarAnexos(id, { prefixo = '', rotulo = 'Anexo' } = {}) {
  const anexos = [];
  fs.mkdirSync(P.nfOrig, { recursive: true });
  while (true) {
    const bruto = await pergunta('\n  ' + rotulo + ' ' + (anexos.length + 1) + ' — caminho do PDF/foto (enter p/ encerrar)');
    if (!bruto) break;
    const origem = limparCaminho(bruto);
    if (!fs.existsSync(origem)) { console.log('  ↳ arquivo não encontrado.'); continue; }
    const base = path.basename(origem).replace(/[^\w.\-]+/g, '_');
    const arquivo = id + '-' + prefixo + (anexos.length + 1) + '-' + base;
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
    const nAnexos = anexosDe(l).length;
    const clipe = nAnexos ? '  [' + nAnexos + ' anexo(s)]' : '';
    const st = l.status === 'pago' ? ''
      : l.status === 'reembolsado' && l.reembolso
        ? '  «reembolsado por ' + l.reembolso.por + ' em ' + l.reembolso.data.split('-').reverse().join('/') + '»'
        : '  «' + l.status + '»';
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
  ledger.lancamentos.splice(i, 1);
  const usados = new Set(ledger.lancamentos.flatMap((x) => anexosDe(x).map((a) => a.arquivo)));
  for (const a of anexosDe(l)) {
    if (usados.has(a.arquivo)) continue;
    const f = path.join(P.nfOrig, a.arquivo);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  gravarLedger(ledger);
  console.log('  ✓ removido.');
  await build();
  await talvezPublicar();
}

// ---------------------------------------------------------------- senha / restore

function cmdSenha() {
  console.log('\n  As senhas compartilhadas foram substituídas por usuários.');
  console.log('  Para trocar a senha de alguém:  node heli.mjs usuario senha <login>\n');
}

// ---------------------------------------------------------------- usuários

const AJUDA_USUARIO = `
  Acessos ao site — um login e uma senha por pessoa

    node heli.mjs usuario listar
    node heli.mjs usuario criar <login> "<Nome>" [total|resumo]   (padrão: total)
    node heli.mjs usuario senha <login>       troca a senha
    node heli.mjs usuario remover <login>     tira o acesso e troca as chaves

  A senha é gerada automaticamente (24 letras e números) e mostrada uma única vez.
  Com  --digitar  no fim, você digita a senha no terminal (escondida, duas vezes).
  Nada muda no site até publicar (botão Publicar do painel ou  node heli.mjs publish).

`;

/**
 * Mostra as senhas recém-sorteadas. Num terminal de verdade, na tela. Quando a
 * saída está sendo capturada (rodado por outro programa), grava num arquivo em
 * local/ e abre no Bloco de Notas, para a senha não ficar registrada em log.
 */
function entregarSenha(itens) {
  const linhas = itens.map((i) =>
    `  ${i.nome}  ·  acesso ${i.nivel}\n    login:  ${i.login}\n    senha:  ${i.senha}`);
  const texto = linhas.join('\n\n');
  if (process.stdout.isTTY) {
    console.log('\n  ── Senha(s) — anote agora, não aparecem de novo ─────────\n');
    console.log(texto);
    console.log('\n  Repasse por um canal privado. Ninguém mais tem cópia delas.\n');
    return;
  }
  const arq = path.join(P.local, 'senhas-para-entregar.txt');
  fs.appendFileSync(arq, `${new Date().toLocaleString('pt-BR')}\n\n${texto}\n\n` +
    `Repasse por um canal privado e APAGUE este arquivo depois.\n\n`, 'utf8');
  console.log('\n  Senha(s) gravada(s) em local/senhas-para-entregar.txt (abrindo no Bloco de Notas).');
  console.log('  Repasse e apague o arquivo depois.\n');
  if (!process.env.HELI_NAO_ABRIR) {
    try { spawn('notepad', [arq], { detached: true, stdio: 'ignore' }).unref(); } catch { /* sem bloco de notas */ }
  }
}

/** Senha gerada (padrão: devolve null) ou digitada (--digitar, exige um terminal de verdade). */
async function obterSenha(digitar, rotulo) {
  if (!digitar) return null;
  if (!process.stdin.isTTY) {
    throw new Error('Para digitar a senha, rode este comando num PowerShell seu (dentro de Heli\\contas),\n' +
      '    não pelo "!" do Claude. Sem  --digitar  a senha é gerada automaticamente.');
  }
  return lerSenhaNova(rotulo);
}

async function cmdUsuario() {
  const args = process.argv.slice(3);
  const digitar = args.includes('--digitar');
  const [acao, alvo, ...resto] = args.filter((a) => a !== '--digitar');
  const seg = lerSegredos();
  if (!seg && acao !== undefined && acao !== 'listar') {
    console.log('\n  Rode primeiro:  node heli.mjs init\n');
    return;
  }

  if (!acao || acao === 'ajuda') { console.log(AJUDA_USUARIO); return; }

  if (acao === 'listar' || acao === 'ls') {
    const lista = listarUsuarios(seg);
    if (seg && !seg.chaveTotal) console.log('\n  Ainda no modelo antigo (senhas TOTAL/RESUMO compartilhadas).');
    if (!lista.length) { console.log('\n  Nenhum usuário ainda.' + AJUDA_USUARIO); return; }
    console.log('');
    for (const u of lista) {
      const quando = u.senhaDefinidaEm ? new Date(u.senhaDefinidaEm).toLocaleDateString('pt-BR') : '—';
      console.log(`  ${u.login.padEnd(14)} ${u.nome.padEnd(22)} ${u.nivel.padEnd(7)} senha de ${quando}`);
    }
    const rest = Object.keys(seg.acessosRestaurados || {}).length;
    if (rest) console.log(`\n  + ${rest} acesso(s) vindo(s) de um restore, sem nome conhecido aqui.`);
    console.log('');
    return;
  }

  if (acao === 'criar' || acao === 'novo') {
    const nivel = (resto[1] || 'total').toLowerCase();
    if (!alvo || !resto[0] || !NIVEIS.includes(nivel)) { console.log(AJUDA_USUARIO); return; }
    validarNovoUsuario(seg, alvo, resto[0], nivel);
    const digitada = await obterSenha(digitar, `  Senha de ${resto[0]}`);
    const migrando = !seg.chaveTotal;
    garantirChaves(seg);
    const senha = await criarUsuario(seg, alvo, resto[0], nivel, digitada);
    gravarSegredos(seg);
    await build({ verboso: false });
    if (digitada) console.log(`
  ✓ usuário ${normalizarLogin(alvo)} (${resto[0]}, acesso ${nivel}) criado.`);
    else entregarSenha([{ login: normalizarLogin(alvo), nome: resto[0], nivel, senha }]);
    if (migrando) {
      console.log('  As senhas compartilhadas TOTAL e RESUMO foram desligadas. Crie todos os');
      console.log('  usuários antes de publicar: depois de publicar, só entra quem tiver login.\n');
    }
    console.log('  Vale no site depois de publicar.\n');
    return;
  }

  if (acao === 'senha') {
    if (!alvo) { console.log(AJUDA_USUARIO); return; }
    const u = seg.usuarios?.[normalizarLogin(alvo)];
    if (!u) throw new Error(`Usuário "${alvo}" não encontrado.`);
    const digitada = await obterSenha(digitar, `  Nova senha de ${u.nome}`);
    const senha = await trocarSenha(seg, alvo, digitada);
    gravarSegredos(seg);
    await build({ verboso: false });
    if (digitada) console.log(`
  ✓ senha de ${normalizarLogin(alvo)} trocada.`);
    else entregarSenha([{ login: normalizarLogin(alvo), nome: u.nome, nivel: u.nivel, senha }]);
    console.log('  A senha antiga para de funcionar quando você publicar.\n');
    return;
  }

  if (acao === 'remover' || acao === 'rm') {
    if (!alvo) { console.log(AJUDA_USUARIO); return; }
    const restam = Object.keys(seg.usuarios || {}).filter((l) => l !== normalizarLogin(alvo));
    if (!restam.length) { console.log('\n  Não dá para remover o último usuário: ninguém mais abriria o site.\n'); return; }
    const perdidos = removerUsuario(seg, alvo);
    gravarSegredos(seg);
    await build({ verboso: false });
    console.log(`\n  ✓ ${normalizarLogin(alvo)} removido. As chaves dos dados foram trocadas e tudo foi recifrado.`);
    if (perdidos) console.log(`  ${perdidos} acesso(s) vindo(s) de restore foram descartados: recrie esses usuários.`);
    console.log('  Vale no site depois de publicar.\n');
    return;
  }

  console.log(AJUDA_USUARIO);
}

async function cmdRestore() {
  // Reconstrói local/ledger.json a partir do que está publicado — resgate se o PC for perdido.
  const meta = JSON.parse(fs.readFileSync(path.join(P.dados, 'meta.json'), 'utf8'));
  const login = normalizarLogin(await pergunta('  Login (acesso total)'));
  const senha = await senhaOculta('  Senha');
  const env = meta.usuarios?.[await idDoLogin(login)];
  let ledger, chave, conteudo, kek;
  try {
    kek = await derivarBits(senha, b64.to(env.salt));
    conteudo = paraObjeto(await decifrar(await importarChave(kek), env));
    if (!conteudo.kt) throw new Error('sem acesso total');
    chave = await importarChave(b64.to(conteudo.kt));
    ledger = paraObjeto(await decifrar(chave, JSON.parse(fs.readFileSync(path.join(P.dados, 'ledger.enc'), 'utf8'))));
  } catch {
    console.log('\n  Login ou senha incorretos (o restore exige um usuário com acesso total).\n');
    process.exit(1);
  }
  fs.mkdirSync(P.nfOrig, { recursive: true });
  for (const l of ledger.lancamentos) {
    for (const a of anexosDe(l)) {
      const src = path.join(P.nfEnc, a.arquivo + '.enc');
      if (!fs.existsSync(src)) continue;
      const bytes = await decifrar(chave, JSON.parse(fs.readFileSync(src, 'utf8')));
      fs.writeFileSync(path.join(P.nfOrig, a.arquivo), bytes);
    }
  }
  delete ledger.escopo;
  delete ledger.geradoEm;
  gravarLedger(ledger);

  // Chaves de volta. O seu usuário é recriado com a sua senha; os dos outros
  // seguem valendo pelos envelopes publicados, até a próxima troca de chaves.
  const seg = lerSegredos() || {};
  seg.chaveTotal = conteudo.kt;
  seg.chaveResumo = conteudo.kr;
  seg.idChave = meta.idChave;
  seg.usuarios = {
    [login]: { nome: conteudo.nome, nivel: 'total', salt: env.salt, kek: b64.from(kek), senhaDefinidaEm: new Date().toISOString() },
  };
  const meuId = await idDoLogin(login);
  seg.acessosRestaurados = Object.fromEntries(Object.entries(meta.usuarios).filter(([id]) => id !== meuId));
  gravarSegredos(seg);
  console.log('\n  ✓ restaurados ' + ledger.lancamentos.length + ' lançamentos, seus anexos e as chaves em local/.');
  console.log('  Os outros usuários continuam entrando com as senhas de sempre. Para tê-los');
  console.log('  com nome aqui, recrie-os (node heli.mjs usuario criar ...) e repasse as senhas novas.\n');
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

// ---------------------------------------------------------------- formulário de envio

async function cmdEnvio() {
  const r = await montarWorker();
  const cfg = configuracaoEnvio();

  console.log(`
  ── Formulário público de envio ─────────────────────────

  ✓ arquivo gerado: envio/dist/worker.js  (${(r.bytes / 1024).toFixed(0)} KB)`);

  if (r.chaveNova) {
    console.log(`  ✓ par de chaves criado, guardado em local/segredos.json

    A chave privada fica só aí. Sem ela, nenhum envio recebido pode ser
    aberto — nem por você, nem por ninguém.`);
  }

  if (cfg.url) {
    console.log(`
  Recebedor já configurado: ${cfg.url}
  Link para divulgar:       ${linkPublico()}

  Republicou o Worker? Suba o arquivo novo na Cloudflare; nada mais muda.
`);
    return;
  }

  console.log(`
  Falta publicar o recebedor. Crie a conta em dash.cloudflare.com — o plano
  gratuito basta, e ao contrário do da Vercel ele permite uso comercial.

  ── Pelo terminal, que é o caminho mais curto ───────────

  Cinco comandos, de dentro da pasta  contas/envio :

    npx wrangler login
    npx wrangler r2 bucket create heli-envios
    npx wrangler secret put SEGREDO_ADMIN     (invente uma senha longa)
    npx wrangler secret put CODIGO            (uma palavra curta, vai no link)
    npx wrangler deploy

  O primeiro abre o navegador uma vez para autorizar. O último imprime a URL
  do recebedor. Guarde a senha do SEGREDO_ADMIN: você vai colá-la a seguir.

  ── Ou pelo painel, se preferir clicar ──────────────────

   1. Workers & Pages  →  Create  →  Worker  →  Deploy
   2. No Worker criado, botão  Edit code  — apague o exemplo e cole o
      conteúdo de  envio/dist/worker.js  , depois  Deploy
   3. Settings → Bindings:  R2 bucket, variável ENVIOS, bucket heli-envios
   4. Settings → Variables:  SEGREDO_ADMIN e CODIGO, marcados como Secret
   5. Em R2, crie antes o bucket  heli-envios

  ── Depois, dos dois jeitos ─────────────────────────────

    node heli.mjs envio-config
`);
}

async function cmdEnvioConfig() {
  const cfg = configuracaoEnvio();
  console.log(`
  ── Endereço do recebedor ───────────────────────────────
`);
  const url = await pergunta('  URL do Worker (ex.: https://heli-envios.suaconta.workers.dev)', cfg.url);

  // Enter mantém o segredo atual. Sem isso, quem vem só trocar o código acaba
  // sobrescrevendo um segredo que estava certo por outro digitado de novo.
  const segredo = await senhaOculta(
    cfg.temSegredo
      ? '  SEGREDO_ADMIN (enter mantém o que já está guardado)'
      : '  SEGREDO_ADMIN (o mesmo que está na Cloudflare)',
  );
  const codigo = await pergunta('  CODIGO do link (enter p/ nenhum)', cfg.codigo);

  configurarEnvio({ url, segredo: segredo || undefined, codigo });
  console.log(`
  ✓ registrado.

  Divulgue este link a quem for mandar nota:

    ${linkPublico()}

  Os envios chegam na Caixa de Entrada do painel.
`);
}

// ---------------------------------------------------------------- roteador

const AJUDA = `
  heli — prestação de contas

    node heli.mjs painel     abre o painel no navegador  ← o jeito fácil
    node heli.mjs envio      gera o formulário público de envio de notas
    node heli.mjs init       configuração inicial (seu usuário + ledger)
    node heli.mjs socios     define os sócios e suas quotas
    node heli.mjs add        registra um lançamento pelo terminal
    node heli.mjs list       lista os lançamentos no terminal
    node heli.mjs acerto     quem deve a quem, e quanto
    node heli.mjs rm <id>    remove um lançamento
    node heli.mjs build      recifra docs/data/ sem publicar
    node heli.mjs publish    build + commit + push
    node heli.mjs usuario    acessos ao site: listar, criar, senha, remover
    node heli.mjs restore    reconstrói o ledger local a partir do publicado
`;

const cmd = process.argv[2];
const rotas = {
  init: cmdInit, painel: cmdPainel, ui: cmdPainel,
  envio: cmdEnvio, 'envio-config': cmdEnvioConfig,
  add: cmdAdd, novo: cmdAdd, list: cmdList, ls: cmdList,
  socios: cmdSocios, acerto: () => mostrarAcerto(lerLedger()),
  rm: () => cmdRm(process.argv[3]), build, publish: cmdPublish, senha: cmdSenha, restore: cmdRestore,
  usuario: cmdUsuario, usuarios: cmdUsuario,
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
