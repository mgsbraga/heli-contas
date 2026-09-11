/**
 * Formulário público de envio de notas.
 *
 * Monta o arquivo do Cloudflare Worker pronto para publicar e conversa com ele
 * a partir do painel: lista o que chegou, baixa e decifra aqui na máquina.
 *
 * O que o Worker guarda é opaco. Tudo que é legível só passa a existir depois da
 * decifragem, que acontece neste processo, com a chave privada de local/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, lerSegredos, gravarSegredos } from './io.mjs';
import { garantirChaves, chavePublicaJwk, decifrarEnvio } from './chaves.mjs';

const P_ENVIO = {
  molde: path.join(RAIZ, 'envio', 'worker.js'),
  form: path.join(RAIZ, 'envio', 'formulario.html'),
  saida: path.join(RAIZ, 'envio', 'dist', 'worker.js'),
};

/** Gera envio/dist/worker.js com a chave pública e o formulário embutidos. */
export async function montarWorker() {
  const { publica, nova } = await garantirChaves();
  const molde = fs.readFileSync(P_ENVIO.molde, 'utf8');
  const html = fs.readFileSync(P_ENVIO.form, 'utf8');

  const worker = molde
    .replace('__CHAVE_PUBLICA__', JSON.stringify(publica, null, 2))
    // JSON.stringify devolve um literal de string JavaScript já escapado,
    // então o HTML entra inteiro sem risco de quebrar o arquivo
    .replace('__HTML__', JSON.stringify(html));

  fs.mkdirSync(path.dirname(P_ENVIO.saida), { recursive: true });
  fs.writeFileSync(P_ENVIO.saida, worker, 'utf8');
  return { arquivo: P_ENVIO.saida, bytes: worker.length, chaveNova: nova };
}

// ---------------------------------------------------------------- configuração

export function configuracaoEnvio() {
  const s = lerSegredos() || {};
  return {
    url: s.envioUrl || '',
    codigo: s.envioCodigo || '',
    temSegredo: Boolean(s.envioSegredo),
    temChaves: Boolean(s.envioPrivada),
  };
}

export function configurarEnvio({ url, segredo, codigo }) {
  const s = lerSegredos();
  if (!s) throw new Error('Configure o sistema antes: node heli.mjs init');
  if (url !== undefined) s.envioUrl = String(url || '').trim().replace(/\/+$/, '');
  if (segredo !== undefined) s.envioSegredo = String(segredo || '').trim();
  if (codigo !== undefined) s.envioCodigo = String(codigo || '').trim();
  gravarSegredos(s);
  return configuracaoEnvio();
}

/** Link para divulgar a quem vai mandar nota. */
export function linkPublico() {
  const { url, codigo } = configuracaoEnvio();
  if (!url) return '';
  return codigo ? `${url}/?c=${encodeURIComponent(codigo)}` : `${url}/`;
}

// ---------------------------------------------------------------- conversa com o Worker

async function chamar(caminho, { metodo = 'GET' } = {}) {
  const s = lerSegredos() || {};
  if (!s.envioUrl) throw new Error('Formulário de envio não configurado.');
  if (!s.envioSegredo) throw new Error('Segredo de administração não configurado.');

  const r = await fetch(s.envioUrl + caminho, {
    method: metodo,
    headers: { 'x-heli-admin': s.envioSegredo },
  });
  if (r.status === 401) throw new Error('O segredo de administração não confere com o do Worker.');
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.erro || `O recebedor respondeu ${r.status}.`);
  }
  return r;
}

export async function listarEnvios() {
  const { url } = configuracaoEnvio();
  if (!url) return { ativo: false, itens: [] };
  try {
    const r = await chamar('/api/listar');
    const { itens } = await r.json();
    return { ativo: true, url, itens: itens || [] };
  } catch (e) {
    return { ativo: false, url, erro: e.message, itens: [] };
  }
}

/** Baixa e decifra. O conteúdo legível só existe daqui para dentro. */
export async function baixarEnvio(chave) {
  const r = await chamar(`/api/baixar?chave=${encodeURIComponent(chave)}`);
  const pacote = await r.json();
  return decifrarEnvio(pacote);
}

export async function apagarEnvio(chave) {
  await chamar(`/api/apagar?chave=${encodeURIComponent(chave)}`, { metodo: 'POST' });
  return { ok: true };
}

export { chavePublicaJwk };
