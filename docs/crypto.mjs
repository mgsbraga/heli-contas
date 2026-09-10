// Envelope de criptografia — mesmo código roda no Node (CLI) e no navegador (visualizador).
// AES-256-GCM, chave derivada da senha por PBKDF2-SHA256.
// Este arquivo é copiado para docs/crypto.mjs no build. Não use APIs exclusivas do Node aqui.

export const KDF_ITER = 600000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = {
  from(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  },
  to(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

export function novoSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

export async function derivarChave(senha, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: KDF_ITER, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Envelope = { iv, ct } em base64. O salt vive no meta.json, um por escopo.
export async function cifrar(chave, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, bytes);
  return { iv: b64.from(iv), ct: b64.from(ct) };
}

export async function decifrar(chave, envelope) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64.to(envelope.iv) },
    chave,
    b64.to(envelope.ct),
  );
  return new Uint8Array(plain);
}

export const paraBytes = (obj) => enc.encode(JSON.stringify(obj));
export const paraObjeto = (bytes) => JSON.parse(dec.decode(bytes));
