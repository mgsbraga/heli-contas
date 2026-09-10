/**
 * Caixa de entrada de notas.
 *
 * Outras pessoas depositam arquivos numa pasta — tipicamente uma pasta compartilhada
 * do OneDrive, que funciona do celular também. O painel lê essa pasta, aplica a
 * leitura determinística em cada arquivo e mostra o que encontrou. Nada entra no
 * ledger sem você conferir e mandar lançar.
 *
 * Depois de lançado, o arquivo de origem não é apagado: vai para "processadas",
 * preservando a trilha de quem mandou o quê e quando.
 */
import fs from 'node:fs';
import path from 'node:path';
import { P, lerSegredos, gravarSegredos } from './io.mjs';
import { lerNota } from './nfe.mjs';
import { mimeDe } from './build.mjs';

export const SUBPASTAS = { processadas: 'processadas', descartadas: 'descartadas' };

const EXTENSOES = /\.(xml|pdf|jpe?g|png|webp|heic)$/i;

export function pastaEntrada() {
  const seg = lerSegredos();
  return seg?.pastaEntrada || '';
}

export function definirPastaEntrada(caminho) {
  const limpo = String(caminho || '').replace(/^["']|["']$/g, '').trim();
  const seg = lerSegredos();
  if (!seg) throw new Error('Configure o sistema antes: node heli.mjs init');

  if (!limpo) {
    delete seg.pastaEntrada;
    gravarSegredos(seg);
    return { ok: true, pasta: '', desligada: true };
  }
  if (!fs.existsSync(limpo)) return { ok: false, erro: 'Essa pasta não existe neste computador.' };
  if (!fs.statSync(limpo).isDirectory()) return { ok: false, erro: 'Esse caminho não é uma pasta.' };

  // as subpastas de arquivo morto são criadas na primeira vez
  for (const sub of Object.values(SUBPASTAS)) {
    fs.mkdirSync(path.join(limpo, sub), { recursive: true });
  }
  seg.pastaEntrada = limpo;
  gravarSegredos(seg);
  return { ok: true, pasta: limpo };
}

/** Só arquivos soltos na raiz da pasta — o que já foi tratado está nas subpastas. */
export function listarEntrada({ comLeitura = true } = {}) {
  const pasta = pastaEntrada();
  if (!pasta) return { pasta: '', ativa: false, itens: [] };
  if (!fs.existsSync(pasta)) return { pasta, ativa: false, erro: 'A pasta configurada não existe mais.', itens: [] };

  const itens = [];
  for (const nome of fs.readdirSync(pasta)) {
    const completo = path.join(pasta, nome);
    let st;
    try { st = fs.statSync(completo); } catch { continue; }
    if (st.isDirectory()) continue;
    if (!EXTENSOES.test(nome)) continue;

    const item = {
      nome,
      tamanho: st.size,
      mime: mimeDe(nome),
      recebidoEm: st.mtime.toISOString(),
    };
    if (comLeitura) {
      // A leitura de imagem depende do decodificador de QR, que roda no navegador;
      // aqui só damos conta de XML e PDF.
      if (/\.(xml|pdf)$/i.test(nome)) {
        try {
          item.leitura = lerNota({ nome, mime: item.mime, bytes: fs.readFileSync(completo) });
        } catch (e) {
          item.leitura = { erro: e.message };
        }
      } else {
        item.leitura = { pendenteNoNavegador: true };
      }
    }
    itens.push(item);
  }
  itens.sort((a, b) => a.recebidoEm.localeCompare(b.recebidoEm));
  return { pasta, ativa: true, itens };
}

function caminhoSeguro(nome) {
  const pasta = pastaEntrada();
  if (!pasta) return null;
  const base = path.basename(String(nome || ''));       // nunca aceita caminho
  if (!base || !EXTENSOES.test(base)) return null;
  const completo = path.join(pasta, base);
  if (path.dirname(completo) !== path.resolve(pasta)) return null;
  return fs.existsSync(completo) ? completo : null;
}

export function lerArquivoEntrada(nome) {
  const completo = caminhoSeguro(nome);
  return completo ? { caminho: completo, bytes: fs.readFileSync(completo) } : null;
}

/** Move para "processadas" ou "descartadas", sem sobrescrever homônimos. */
export function arquivarEntrada(nome, destino = 'processadas') {
  const completo = caminhoSeguro(nome);
  if (!completo) return { ok: false, erro: 'Arquivo não encontrado na pasta de entrada.' };
  const sub = SUBPASTAS[destino] || SUBPASTAS.processadas;
  const alvo = path.join(pastaEntrada(), sub);
  fs.mkdirSync(alvo, { recursive: true });

  const base = path.basename(completo);
  let final = path.join(alvo, base);
  if (fs.existsSync(final)) {
    const ext = path.extname(base);
    final = path.join(alvo, `${path.basename(base, ext)}-${Date.now()}${ext}`);
  }
  fs.renameSync(completo, final);
  return { ok: true, movidoPara: final };
}
