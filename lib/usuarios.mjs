/**
 * Usuários do site — um login e uma senha por pessoa, sem servidor.
 *
 * Os dados são cifrados com duas chaves sorteadas (total e resumo), guardadas só
 * em local/segredos.json. Cada usuário recebe, no meta.json público, um envelope
 * com essas chaves trancado pela chave dele (PBKDF2 da senha). Login + senha
 * destrancam o envelope no navegador; nada vai a servidor algum.
 *
 *  - O envelope de quem é "total" leva as duas chaves; o de "resumo", só a do resumo.
 *  - No meta.json o login aparece só como hash; nome e nível vão dentro do envelope.
 *  - Remover um usuário sorteia chaves novas e recifra tudo: o envelope antigo dele
 *    deixa de abrir o que for publicado dali em diante.
 *
 * local/segredos.json guarda, por usuário, a chave derivada da senha (não a senha):
 * é o que permite trocar as chaves dos dados sem pedir a senha de cada um.
 */
import { b64, novoSalt, derivarBits, importarChave, cifrar, paraBytes, chaveAleatoria, idDoLogin } from './crypto.mjs';
import { gerarSenha } from './senhas.mjs';

export const NIVEIS = ['total', 'resumo'];

export const normalizarLogin = (s) => String(s || '').trim().toLowerCase();
export const loginValido = (s) => /^[a-z0-9][a-z0-9._-]{1,31}$/.test(s);

const novoIdChave = () => b64.from(crypto.getRandomValues(new Uint8Array(9))).replace(/[+/=]/g, '');

/** Sorteia as chaves dos dados. */
export function rotacionarChaves(seg) {
  seg.chaveTotal = b64.from(chaveAleatoria());
  seg.chaveResumo = b64.from(chaveAleatoria());
  seg.idChave = novoIdChave();
  return seg;
}

/**
 * Passa do modelo antigo (duas senhas compartilhadas) para o de usuários.
 * As senhas compartilhadas deixam de existir: o que for publicado depois disso só
 * abre com login.
 */
export function garantirChaves(seg) {
  seg = seg || {};
  if (!seg.chaveTotal || !seg.chaveResumo || !seg.idChave) rotacionarChaves(seg);
  delete seg.senhaTotal; delete seg.senhaResumo; delete seg.saltFull; delete seg.saltResumo;
  seg.usuarios = seg.usuarios || {};
  return seg;
}

export const temUsuarios = (seg) =>
  !!seg?.chaveTotal && (Object.keys(seg.usuarios || {}).length + Object.keys(seg.acessosRestaurados || {}).length) > 0;

async function definirSenha(u, senha) {
  const salt = novoSalt();
  u.salt = b64.from(salt);
  u.kek = b64.from(await derivarBits(senha, salt));
  u.senhaDefinidaEm = new Date().toISOString();
}

/** Confere login e nível antes de pedir a senha. Lança erro se algo não serve. */
export function validarNovoUsuario(seg, login, nome, nivel) {
  login = normalizarLogin(login);
  if (!loginValido(login)) throw new Error('Login inválido: use 2 a 32 letras minúsculas, números, ponto, hífen ou sublinhado.');
  if (!NIVEIS.includes(nivel)) throw new Error('Nível deve ser "total" ou "resumo".');
  if (!String(nome || '').trim()) throw new Error('Informe o nome da pessoa.');
  if (seg?.usuarios?.[login]) throw new Error(`O usuário "${login}" já existe. Para trocar a senha:  node heli.mjs usuario senha ${login}`);
}

/**
 * Cria o usuário com a senha dada (ou sorteada, se não vier nenhuma) e devolve a
 * senha. Ela não fica guardada em lugar nenhum: só a chave derivada dela.
 */
export async function criarUsuario(seg, login, nome, nivel = 'total', senhaDada = null) {
  login = normalizarLogin(login);
  if (!loginValido(login)) throw new Error('Login inválido: use 2 a 32 letras minúsculas, números, ponto, hífen ou sublinhado.');
  if (!NIVEIS.includes(nivel)) throw new Error('Nível deve ser "total" ou "resumo".');
  if (!String(nome || '').trim()) throw new Error('Informe o nome da pessoa.');
  garantirChaves(seg);
  if (seg.usuarios[login]) throw new Error(`O usuário "${login}" já existe. Para trocar a senha:  node heli.mjs usuario senha ${login}`);
  const u = { nome: String(nome).trim(), nivel, criadoEm: new Date().toISOString() };
  const senha = senhaDada || gerarSenha();
  await definirSenha(u, senha);
  seg.usuarios[login] = u;
  return senha;
}

export async function trocarSenha(seg, login, senhaDada = null) {
  const u = seg?.usuarios?.[normalizarLogin(login)];
  if (!u) throw new Error(`Usuário "${login}" não encontrado.`);
  const senha = senhaDada || gerarSenha();
  await definirSenha(u, senha);
  return senha;
}

/**
 * Remove o usuário e troca as chaves dos dados. Acessos restaurados de um backup
 * (sem a chave do usuário guardada aqui) não sobrevivem à troca: são descartados
 * e a função devolve quantos foram.
 */
export function removerUsuario(seg, login) {
  login = normalizarLogin(login);
  if (!seg?.usuarios?.[login]) throw new Error(`Usuário "${login}" não encontrado.`);
  delete seg.usuarios[login];
  rotacionarChaves(seg);
  const perdidos = Object.keys(seg.acessosRestaurados || {}).length;
  delete seg.acessosRestaurados;
  return perdidos;
}

/** Envelopes publicados no meta.json: { idDoLogin: { salt, iv, ct } }. */
export async function montarAcessos(seg) {
  const acessos = {};
  for (const [login, u] of Object.entries(seg.usuarios || {})) {
    const kek = await importarChave(b64.to(u.kek));
    const conteudo = u.nivel === 'total'
      ? { nome: u.nome, nivel: 'total', kt: seg.chaveTotal, kr: seg.chaveResumo }
      : { nome: u.nome, nivel: 'resumo', kr: seg.chaveResumo };
    acessos[await idDoLogin(login)] = { salt: u.salt, ...(await cifrar(kek, paraBytes(conteudo))) };
  }
  // envelopes que vieram de um restore e cujo dono não foi recriado aqui
  for (const [id, env] of Object.entries(seg.acessosRestaurados || {})) {
    if (!acessos[id]) acessos[id] = env;
  }
  return acessos;
}

/** A senha nunca fica em disco além do aviso de entrega: ela é mostrada uma vez. */
export const listarUsuarios = (seg) =>
  Object.entries(seg?.usuarios || {}).map(([login, u]) => ({ login, nome: u.nome, nivel: u.nivel, senhaDefinidaEm: u.senhaDefinidaEm }));
