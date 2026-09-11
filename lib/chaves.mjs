/**
 * Par de chaves para o formulário público de envio.
 *
 * Quem envia uma nota cifra no próprio navegador com a CHAVE PÚBLICA, que é
 * distribuída abertamente no formulário. Só a CHAVE PRIVADA, que nunca sai de
 * local/segredos.json, decifra. O servidor que recebe o envio guarda bytes que
 * ele mesmo não consegue ler.
 *
 * Esquema híbrido, porque RSA não cifra volume: sorteia-se uma chave AES-256 por
 * envio, o conteúdo vai em AES-GCM e só a chave AES viaja dentro do RSA-OAEP.
 */
import { b64 } from './crypto.mjs';
import { lerSegredos, gravarSegredos } from './io.mjs';

export const ALG_RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };
const PARAMS = { ...ALG_RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) };

export async function gerarParDeChaves() {
  const par = await crypto.subtle.generateKey(PARAMS, true, ['encrypt', 'decrypt']);
  return {
    publica: await crypto.subtle.exportKey('jwk', par.publicKey),
    privada: await crypto.subtle.exportKey('jwk', par.privateKey),
  };
}

/** Cria o par na primeira vez; nas seguintes devolve o que já existe. */
export async function garantirChaves() {
  const seg = lerSegredos();
  if (!seg) throw new Error('Configure o sistema antes: node heli.mjs init');
  if (seg.envioPublica && seg.envioPrivada) {
    return { publica: seg.envioPublica, privada: seg.envioPrivada, nova: false };
  }
  const par = await gerarParDeChaves();
  seg.envioPublica = par.publica;
  seg.envioPrivada = par.privada;
  gravarSegredos(seg);
  return { ...par, nova: true };
}

export function chavePublicaJwk() {
  return lerSegredos()?.envioPublica || null;
}

async function importarPrivada() {
  const jwk = lerSegredos()?.envioPrivada;
  if (!jwk) throw new Error('Chave privada de envio não encontrada. Rode: node heli.mjs envio');
  return crypto.subtle.importKey('jwk', jwk, ALG_RSA, false, ['decrypt']);
}

/**
 * Abre um pacote vindo do formulário.
 * Devolve { metadados, arquivos } — ou lança, se o pacote não for para esta chave.
 */
export async function decifrarEnvio(pacote) {
  if (!pacote || pacote.v !== 1) throw new Error('Formato de envio desconhecido.');
  const privada = await importarPrivada();

  const chaveBruta = await crypto.subtle.decrypt(ALG_RSA, privada, b64.to(pacote.chave));
  const aes = await crypto.subtle.importKey('raw', chaveBruta, 'AES-GCM', false, ['decrypt']);
  const claro = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64.to(pacote.iv) },
    aes,
    b64.to(pacote.ct),
  );
  return JSON.parse(new TextDecoder().decode(claro));
}

/** Só para os testes: cifra do jeito que o formulário cifra. */
export async function cifrarEnvioComPublica(jwkPublica, conteudo) {
  const publica = await crypto.subtle.importKey('jwk', jwkPublica, ALG_RSA, false, ['encrypt']);
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aes,
    new TextEncoder().encode(JSON.stringify(conteudo)),
  );
  const bruta = await crypto.subtle.exportKey('raw', aes);
  return {
    v: 1,
    alg: 'RSA-OAEP-3072+AES-256-GCM',
    chave: b64.from(await crypto.subtle.encrypt(ALG_RSA, publica, bruta)),
    iv: b64.from(iv),
    ct: b64.from(ct),
  };
}
