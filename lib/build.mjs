// Gera os artefatos cifrados em docs/data/ a partir do ledger local em claro.
import fs from 'node:fs';
import path from 'node:path';
import { importarChave, derivarChave, cifrar, paraBytes, b64, KDF_ITER } from './crypto.mjs';
import { temUsuarios, montarAcessos } from './usuarios.mjs';
import { P, lerLedger, lerSegredos, brl, anexosDe } from './io.mjs';
import { montarRateio, pagadorEfetivo } from './rateio.mjs';

const MIMES = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic',
  '.xml': 'text/xml', '.txt': 'text/plain',
};
export const mimeDe = (arq) => MIMES[path.extname(arq).toLowerCase()] || 'application/octet-stream';

// O escopo "resumo" enxerga só agregados. Nenhum fornecedor, NF, descrição ou anexo.
// O acerto entre sócios entra aqui: é informação consolidada, sem detalhe de despesa,
// e é justamente o que um sócio precisa ver sem acesso ao ledger completo.
export function montarResumo(ledger, rateio) {
  const acc = (chave) => {
    const m = new Map();
    for (const l of ledger.lancamentos) {
      const k = chave(l) || '—';
      const cur = m.get(k) || { total: 0, qtd: 0 };
      cur.total = Math.round((cur.total + l.valor) * 100) / 100;
      cur.qtd += 1;
      m.set(k, cur);
    }
    return [...m.entries()]
      .map(([nome, v]) => ({ nome, ...v }))
      .sort((a, b) => b.total - a.total);
  };
  const total = ledger.lancamentos.reduce((s, l) => s + l.valor, 0);
  return {
    escopo: 'resumo',
    org: ledger.org,
    moeda: ledger.moeda,
    geradoEm: new Date().toISOString(),
    totalGeral: Math.round(total * 100) / 100,
    qtdLancamentos: ledger.lancamentos.length,
    porCategoria: acc((l) => l.categoria),
    porMes: acc((l) => l.data?.slice(0, 7)).sort((a, b) => a.nome.localeCompare(b.nome)),
    porPagador: acc(pagadorEfetivo),
    porStatus: acc((l) => l.status),
    rateio,
  };
}

export async function build({ verboso = true } = {}) {
  const ledger = lerLedger();
  const seg = lerSegredos();
  // Modelo antigo (duas senhas compartilhadas) segue funcionando até o primeiro
  // "usuario criar", que faz a migração.
  const legado = !seg?.chaveTotal && !!seg?.senhaTotal;
  if (!legado && !temUsuarios(seg)) {
    throw new Error('Nenhum usuário configurado. Crie o primeiro:  node heli.mjs usuario criar <login> "<Nome>"');
  }

  const kFull = legado ? await derivarChave(seg.senhaTotal, b64.to(seg.saltFull)) : await importarChave(b64.to(seg.chaveTotal));
  const kResumo = legado ? await derivarChave(seg.senhaResumo, b64.to(seg.saltResumo)) : await importarChave(b64.to(seg.chaveResumo));
  const idChave = legado ? 'senha:' + seg.saltFull : seg.idChave;

  fs.mkdirSync(P.nfEnc, { recursive: true });

  // Chave nova (migração ou remoção de usuário): os anexos cifrados com a antiga
  // não abrem mais e precisam ser recifrados todos.
  const metaArq = path.join(P.dados, 'meta.json');
  const metaAntigo = fs.existsSync(metaArq) ? JSON.parse(fs.readFileSync(metaArq, 'utf8')) : {};
  if ((metaAntigo.idChave || 'senha:' + metaAntigo.saltTotal) !== idChave) {
    for (const f of fs.readdirSync(P.nfEnc)) fs.unlinkSync(path.join(P.nfEnc, f));
  }

  // O acerto entre sócios é calculado uma vez e vai igual nos dois escopos.
  const rateio = montarRateio(ledger);

  // 1. ledger completo
  const completo = { ...ledger, escopo: 'total', rateio, geradoEm: new Date().toISOString() };
  fs.writeFileSync(path.join(P.dados, 'ledger.enc'), JSON.stringify(await cifrar(kFull, paraBytes(completo))));

  // 2. resumo
  fs.writeFileSync(path.join(P.dados, 'resumo.enc'), JSON.stringify(await cifrar(kResumo, paraBytes(montarResumo(ledger, rateio)))));

  // 3. anexos (só na chave total) — cifra o que falta, remove órfãos
  const esperados = new Set();
  let novos = 0;
  for (const l of ledger.lancamentos) {
    for (const a of anexosDe(l)) {
      esperados.add(a.arquivo + '.enc');
      const destino = path.join(P.nfEnc, a.arquivo + '.enc');
      if (fs.existsSync(destino)) continue;
      const origem = path.join(P.nfOrig, a.arquivo);
      if (!fs.existsSync(origem)) {
        console.log(`  ! anexo ausente em local/nf/: ${a.arquivo} (lançamento ${l.id})`);
        continue;
      }
      fs.writeFileSync(destino, JSON.stringify(await cifrar(kFull, new Uint8Array(fs.readFileSync(origem)))));
      novos++;
    }
  }
  let removidos = 0;
  for (const f of fs.readdirSync(P.nfEnc)) {
    if (!esperados.has(f)) { fs.unlinkSync(path.join(P.nfEnc, f)); removidos++; }
  }

  // 4. metadados públicos: nome, data do build e um envelope por usuário. O login
  //    aparece só como hash; nome e nível ficam dentro do envelope cifrado.
  fs.writeFileSync(metaArq, JSON.stringify(legado ? {
    v: 1, kdf: 'PBKDF2-SHA256', iter: KDF_ITER, alg: 'AES-256-GCM',
    org: ledger.org, geradoEm: new Date().toISOString(),
    saltTotal: seg.saltFull, saltResumo: seg.saltResumo,
  } : {
    v: 2, kdf: 'PBKDF2-SHA256', iter: KDF_ITER, alg: 'AES-256-GCM',
    org: ledger.org, geradoEm: new Date().toISOString(),
    idChave,
    usuarios: await montarAcessos(seg),
  }, null, 2));

  // 5. mantém o módulo de cripto do visualizador em sincronia com o do CLI
  fs.copyFileSync(path.join(P.docs, '..', 'lib', 'crypto.mjs'), path.join(P.docs, 'crypto.mjs'));

  const total = ledger.lancamentos.reduce((s, l) => s + l.valor, 0);
  if (verboso) {
    console.log(`\n  ✓ build concluído`);
    console.log(`    ${ledger.lancamentos.length} lançamentos · ${brl(total)}`);
    console.log(`    anexos: ${esperados.size} cifrados (${novos} novos${removidos ? `, ${removidos} órfãos removidos` : ''})`);
    if (rateio) {
      const n = rateio.acertos.length;
      console.log(`    rateio: ${rateio.socios.length} sócios · ${n ? n + ' transferência(s) para acertar' : 'contas equilibradas'}`);
    }
  }
  return { qtd: ledger.lancamentos.length, total };
}
