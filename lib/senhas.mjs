// Senhas geradas: sequência alfanumérica aleatória, sem caracteres que se confundem
// ao ditar ou copiar (0/O, 1/l/I). 24 caracteres de 57 possíveis ≈ 140 bits.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export const TAMANHO_SENHA = 24;

/** Sorteio uniforme (rejeição) com o gerador criptográfico. */
function sortear(n) {
  const limite = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limite);
  return buf[0] % n;
}

/** Ex.: "k7Rm4XpQ2wZt9HbNc3Fs8YdK". Sempre com ao menos uma maiúscula, uma minúscula e um dígito. */
export function gerarSenha() {
  while (true) {
    const s = Array.from({ length: TAMANHO_SENHA }, () => ALFABETO[sortear(ALFABETO.length)]).join('');
    if (/[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s)) return s;
  }
}
