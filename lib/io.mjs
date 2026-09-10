// Leitura/escrita do ledger local, prompts de terminal e utilitários de formato.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
export const P = {
  local: path.join(RAIZ, 'local'),
  ledger: path.join(RAIZ, 'local', 'ledger.json'),
  segredos: path.join(RAIZ, 'local', 'segredos.json'),
  nfOrig: path.join(RAIZ, 'local', 'nf'),
  docs: path.join(RAIZ, 'docs'),
  dados: path.join(RAIZ, 'docs', 'data'),
  nfEnc: path.join(RAIZ, 'docs', 'data', 'nf'),
};

export const CATEGORIAS_PADRAO = [
  'Certificação ANAC (RBAC 135)',
  'Consultoria e assessoria técnica',
  'Jurídico e societário',
  'Contabilidade',
  'Aeronave — aquisição e entrada em frota',
  'Manutenção e peças',
  'Seguros (casco e RETA)',
  'Hangaragem e pátio',
  'Combustível e lubrificantes',
  'Tripulação — salários e treinamento',
  'Taxas e emolumentos (ANAC / DECEA / Junta)',
  'Marketing e comercial',
  'Administrativo, TI e escritório',
  'Viagens e deslocamentos',
  'Outros',
];

export const FORMAS_PADRAO = ['PIX', 'Transferência (TED)', 'Boleto', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro', 'Débito automático'];

export const LEDGER_VAZIO = {
  org: 'Heli — Táxi Aéreo',
  moeda: 'BRL',
  criadoEm: new Date().toISOString(),
  categorias: CATEGORIAS_PADRAO,
  formas: FORMAS_PADRAO,
  pagadores: [],
  socios: [],        // [{ nome, quota }] — quotas em % somando 100
  lancamentos: [],
};

export function parsePct(txt) {
  const n = Number(String(txt).replace('%', '').replace(',', '.').trim());
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : NaN;
}

export function lerLedger() {
  if (!fs.existsSync(P.ledger)) {
    throw new Error('Ledger local não encontrado. Rode primeiro:  node heli.mjs init');
  }
  return JSON.parse(fs.readFileSync(P.ledger, 'utf8'));
}

export function gravarLedger(l) {
  fs.mkdirSync(P.local, { recursive: true });
  fs.writeFileSync(P.ledger, JSON.stringify(l, null, 2), 'utf8');
}

export function lerSegredos() {
  if (!fs.existsSync(P.segredos)) return null;
  return JSON.parse(fs.readFileSync(P.segredos, 'utf8'));
}

export function gravarSegredos(s) {
  fs.mkdirSync(P.local, { recursive: true });
  fs.writeFileSync(P.segredos, JSON.stringify(s, null, 2), 'utf8');
}

// ---------- formato ----------

export const brl = (n) =>
  (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

export function parseValor(txt) {
  // aceita "1.234,56", "1234.56", "1234,56", "R$ 1.234,56"
  let s = String(txt).replace(/[R$\s]/gi, '').trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export function parseData(txt) {
  const s = String(txt).trim();
  let m = s.match(/^(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{2})[\/\-.](\d{2})$/); // dd/mm do ano corrente
  if (m) return `${new Date().getFullYear()}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

export const hojeISO = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function proximoId(ledger, dataISO) {
  const ano = dataISO.slice(0, 4);
  const usados = ledger.lancamentos
    .filter((l) => l.id.startsWith(ano + '-'))
    .map((l) => Number(l.id.slice(5)))
    .filter(Number.isFinite);
  const n = usados.length ? Math.max(...usados) + 1 : 1;
  return `${ano}-${String(n).padStart(4, '0')}`;
}

// ---------- prompts ----------

const rl = () => readline.createInterface({ input: process.stdin, output: process.stdout });

export function pergunta(texto, padrao = '') {
  const i = rl();
  const rotulo = padrao ? `${texto} [${padrao}]: ` : `${texto}: `;
  return new Promise((res) => {
    i.question(rotulo, (r) => {
      i.close();
      res((r.trim() || padrao).trim());
    });
  });
}

// Lê a senha em modo raw para que nada apareça na tela nem fique no histórico do terminal.
export function senhaOculta(texto) {
  const { stdin, stdout } = process;

  // Sem terminal interativo (pipe, CI) não há o que mascarar: lê a linha direto.
  if (!stdin.isTTY) {
    return new Promise((res) => {
      const i = rl();
      i.question(`${texto}: `, (r) => { i.close(); res(r.trim()); });
    });
  }

  return new Promise((res) => {
    stdout.write(`${texto}: `);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';

    const encerrar = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', aoDigitar);
      stdout.write('\n');
    };

    const aoDigitar = (bloco) => {
      for (const ch of bloco) {
        const cod = ch.charCodeAt(0);
        if (cod === 13 || cod === 10 || cod === 4) { encerrar(); return res(buf.trim()); }  // enter / EOF
        if (cod === 3) { encerrar(); process.exit(130); }                                   // ctrl+c
        if (cod === 127 || cod === 8) {                                                     // backspace
          if (buf.length) { buf = buf.slice(0, -1); stdout.write('\b \b'); }
          continue;
        }
        if (ch >= ' ') { buf += ch; stdout.write('*'); }
      }
    };

    stdin.on('data', aoDigitar);
  });
}

export async function escolher(titulo, opcoes, { permitirNovo = false, padrao = null } = {}) {
  console.log(`\n  ${titulo}`);
  opcoes.forEach((o, i) => console.log(`   ${String(i + 1).padStart(2)}) ${o}`));
  if (permitirNovo) console.log(`    0) + cadastrar novo`);
  while (true) {
    const idxPadrao = padrao ? String(opcoes.indexOf(padrao) + 1) : '';
    const r = await pergunta('  escolha', idxPadrao);
    if (permitirNovo && r === '0') {
      const novo = await pergunta('  nome');
      if (novo) return { valor: novo, novo: true };
      continue;
    }
    const n = Number(r);
    if (Number.isInteger(n) && n >= 1 && n <= opcoes.length) return { valor: opcoes[n - 1], novo: false };
    console.log('  ↳ opção inválida.');
  }
}

export const limparCaminho = (s) => s.replace(/^["']|["']$/g, '').trim();
