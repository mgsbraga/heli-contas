/**
 * Recebedor de notas — Cloudflare Worker.
 *
 * Serve um formulário público e guarda o que chega. O conteúdo é cifrado no
 * navegador de quem envia, com a chave pública embutida na página: este Worker e o
 * bucket que ele usa só enxergam bytes opacos. Nem a Cloudflare, nem quem tiver
 * acesso ao painel da conta, consegue ler uma nota.
 *
 * Por isso o corpo nunca é interpretado aqui — é gravado como veio. Além de
 * preservar o sigilo, isso mantém o uso de CPU dentro dos 10 ms do plano gratuito.
 *
 * Este arquivo é um molde. O arquivo pronto para publicar sai de:
 *     node heli.mjs envio
 *
 * Configuração na Cloudflare (nada disso vive neste arquivo, que é público):
 *   - Binding de R2 chamado ENVIOS
 *   - Variável SEGREDO_ADMIN — segredo que o painel usa para listar e baixar
 *   - Variável CODIGO — código que vai no link divulgado; vazio desliga a exigência
 */

const CHAVE_PUBLICA = {
  "key_ops": [
    "encrypt"
  ],
  "ext": true,
  "alg": "RSA-OAEP-256",
  "kty": "RSA",
  "n": "pT_DIl9ZNhN3OcRAq0Bs295ciZ5gLjp4G0COZj-0TEU5bky3CGgrSG8Xbti-_lUetg1N6RbYYt1vQjmCyyuQBTYqNophWoKiwEi-UKWm_9tthHOhpYS9AlqGck1IA3nIIfy_CmKTv-yUYVaTw8MSMGIGqsETR-WyonSe43ga8eDkAn-snA9zyJjlNrFYVRd3OiRPe2kpMifk44Gfi3pFas2BX7wr0_jxMU1MOo3COF2oz6qZ-67Dt4KbbvxeMmaGtZ0OGb6dh30vboH_jH9vtLjaDdbX157zzYAJmu8709wkf_-AEt08_v3n2a9zaBl7jrRUDBsg6QX4UN5AtqvI_0SodrXy7vC0BoZ9qD7TDL_LGSRweqGbQJJxfOar4xhvLSYdDu1sAuLEJky01sEFc51ETTW_b18E6E-aXcbtqJRmTlripAWAgPrjrCS00lIaCLl-XficvYmkIxsbjSe5NJ_wl3fiNt6jLZ77x9w--XrAu7a3PIdzvJVv30Q5txLJ",
  "e": "AQAB"
};
const PAGINA = "<!doctype html>\r\n<html lang=\"pt-BR\">\r\n<head>\r\n<meta charset=\"utf-8\">\r\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\r\n<meta name=\"robots\" content=\"noindex, nofollow\">\r\n<title>Envio de nota fiscal</title>\r\n<style>\r\n  :root {\r\n    --bg: #0a0e13; --painel: #111820; --painel2: #161f29;\r\n    --linha: #1f2b38; --txt: #e4ecf4; --txt2: #94a5b8; --txt3: #5f7186;\r\n    --acento: #f2a950; --acento-dim: #7a5827; --ok: #4ec9a0; --alerta: #e8825a;\r\n    --sans: \"Inter\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\r\n    --mono: ui-monospace, \"Cascadia Mono\", Menlo, Consolas, monospace;\r\n  }\r\n  * { box-sizing: border-box; }\r\n  html, body { margin: 0; padding: 0; }\r\n  body {\r\n    background: var(--bg); color: var(--txt);\r\n    font: 400 15px/1.6 var(--sans); -webkit-font-smoothing: antialiased;\r\n    padding: 28px 20px 70px;\r\n  }\r\n  .folha { max-width: 540px; margin: 0 auto; }\r\n\r\n  header { text-align: center; margin-bottom: 28px; }\r\n  .marca { width: 42px; height: 42px; color: var(--acento); margin: 0 auto 14px; display: block; }\r\n  h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 6px; }\r\n  .org { font-size: 13px; color: var(--txt3); }\r\n\r\n  .nota {\r\n    background: var(--painel); border: 1px solid var(--linha);\r\n    border-radius: 10px; padding: 14px 17px; margin-bottom: 24px;\r\n    font-size: 13px; color: var(--txt2); line-height: 1.65;\r\n  }\r\n  .nota b { color: var(--txt); font-weight: 600; }\r\n\r\n  label { display: block; font-size: 12px; color: var(--txt3); margin: 0 0 6px; }\r\n  label .obr { color: var(--acento); }\r\n  .campo { margin-bottom: 17px; }\r\n  input, textarea {\r\n    width: 100%; background: var(--painel2); border: 1px solid var(--linha);\r\n    color: var(--txt); border-radius: 9px; padding: 12px 13px;\r\n    font: inherit; outline: none; transition: border-color .15s;\r\n  }\r\n  input:focus, textarea:focus { border-color: var(--acento-dim); }\r\n  input::placeholder, textarea::placeholder { color: #47576a; }\r\n  textarea { resize: vertical; min-height: 78px; }\r\n\r\n  .zona {\r\n    border: 1px dashed var(--linha); border-radius: 10px;\r\n    padding: 26px 18px; text-align: center; color: var(--txt3);\r\n    font-size: 14px; cursor: pointer; transition: border-color .15s, background .15s;\r\n  }\r\n  .zona:hover, .zona.sobre { border-color: var(--acento-dim); background: var(--painel2); color: var(--txt2); }\r\n  .zona b { color: var(--txt2); font-weight: 500; display: block; margin-bottom: 3px; }\r\n  .zona small { font-size: 12px; }\r\n\r\n  .arquivos { margin-top: 11px; display: flex; flex-direction: column; gap: 7px; }\r\n  .arq {\r\n    display: flex; align-items: center; gap: 10px;\r\n    background: var(--painel2); border: 1px solid var(--linha);\r\n    border-radius: 8px; padding: 9px 10px 9px 13px; font-size: 13px; color: var(--txt2);\r\n  }\r\n  .arq .n { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\r\n  .arq .t { color: var(--txt3); font-size: 12px; }\r\n  .arq button {\r\n    background: transparent; border: 0; color: var(--txt3);\r\n    font-size: 17px; line-height: 1; padding: 3px 6px; border-radius: 5px; cursor: pointer;\r\n  }\r\n  .arq button:hover { color: var(--alerta); background: #1d1210; }\r\n\r\n  .btn {\r\n    width: 100%; background: var(--acento); color: #171104; border: 0;\r\n    border-radius: 9px; padding: 14px; font: 600 15px var(--sans);\r\n    cursor: pointer; margin-top: 8px; transition: opacity .15s;\r\n  }\r\n  .btn:hover:not(:disabled) { opacity: .9; }\r\n  .btn:disabled { opacity: .45; cursor: default; }\r\n\r\n  .recado { margin-top: 15px; font-size: 13.5px; min-height: 20px; }\r\n  .recado.ruim { color: var(--alerta); }\r\n  .recado.neutro { color: var(--txt3); }\r\n\r\n  .pronto { text-align: center; padding: 22px 0; }\r\n  .pronto .tique {\r\n    width: 52px; height: 52px; margin: 0 auto 18px; display: block; color: var(--ok);\r\n  }\r\n  .pronto h2 { font-size: 18px; font-weight: 600; margin: 0 0 8px; }\r\n  .pronto p { color: var(--txt2); font-size: 14px; margin: 0 0 20px; }\r\n  .protocolo {\r\n    font-family: var(--mono); font-size: 15px; color: var(--acento);\r\n    background: var(--painel2); border: 1px solid var(--acento-dim);\r\n    border-radius: 9px; padding: 13px; margin-bottom: 22px; word-break: break-all;\r\n  }\r\n  .rodape {\r\n    margin-top: 30px; text-align: center;\r\n    font-size: 11.5px; color: var(--txt3); line-height: 1.7;\r\n  }\r\n  .oculto { display: none !important; }\r\n</style>\r\n</head>\r\n<body>\r\n<div class=\"folha\">\r\n\r\n  <header>\r\n    <svg class=\"marca\" viewBox=\"0 0 48 48\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\r\n      <path d=\"M6 12h36M24 12v5\"/>\r\n      <path d=\"M13 22h16a5 5 0 0 1 5 5v4H18a5 5 0 0 1-5-5v-4Z\"/>\r\n      <path d=\"M34 27h6l-3 4h-3M16 31v5M13 36h8\"/>\r\n    </svg>\r\n    <h1>Envio de nota fiscal</h1>\r\n    <div class=\"org\">Heli Eagle</div>\r\n  </header>\r\n\r\n  <div id=\"invalido\" class=\"pronto oculto\">\r\n    <svg class=\"tique\" style=\"color:#e8825a\" viewBox=\"0 0 48 48\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\">\r\n      <circle cx=\"24\" cy=\"24\" r=\"20\"/><path d=\"M24 14v13M24 33v.5\"/>\r\n    </svg>\r\n    <h2>Este link não vale mais</h2>\r\n    <p>Peça um link atualizado a quem solicitou a nota. O endereço muda de tempos em\r\n       tempos, por segurança.</p>\r\n  </div>\r\n\r\n  <div id=\"carregando\" class=\"pronto\">\r\n    <p style=\"color:#5f7186\">Conferindo o link…</p>\r\n  </div>\r\n\r\n  <div id=\"tela\" class=\"oculto\">\r\n    <div class=\"nota\">\r\n      Envie aqui a nota referente ao serviço ou produto fornecido.\r\n      <b>Se você tiver o arquivo XML da nota, mande ele</b> — é o que evita erro de digitação\r\n      no nosso lado. Não tendo, o PDF ou uma foto legível resolvem.\r\n    </div>\r\n\r\n    <form id=\"form\" autocomplete=\"off\">\r\n      <div class=\"campo\">\r\n        <label for=\"quem\">Seu nome ou o da empresa <span class=\"obr\">*</span></label>\r\n        <input type=\"text\" id=\"quem\" required placeholder=\"Aviation Fuel Services Ltda\">\r\n      </div>\r\n\r\n      <div class=\"campo\">\r\n        <label for=\"contato\">E-mail ou telefone <span style=\"opacity:.7\">— caso precisemos confirmar algo</span></label>\r\n        <input type=\"text\" id=\"contato\" placeholder=\"financeiro@empresa.com.br\">\r\n      </div>\r\n\r\n      <div class=\"campo\">\r\n        <label for=\"assunto\">Do que se trata <span class=\"obr\">*</span></label>\r\n        <textarea id=\"assunto\" required placeholder=\"Abastecimento do dia 08/09, NF-e 12014\"></textarea>\r\n      </div>\r\n\r\n      <div class=\"campo\">\r\n        <label for=\"valor\">Valor <span style=\"opacity:.7\">— se souber</span></label>\r\n        <input type=\"text\" id=\"valor\" inputmode=\"decimal\" placeholder=\"7.431,90\">\r\n      </div>\r\n\r\n      <div class=\"campo\">\r\n        <label>Arquivos <span class=\"obr\">*</span></label>\r\n        <div class=\"zona\" id=\"zona\">\r\n          <b>Toque para escolher a nota</b>\r\n          <small>XML, PDF ou foto · pode mandar mais de um</small>\r\n        </div>\r\n        <input type=\"file\" id=\"arquivo\" multiple class=\"oculto\"\r\n               accept=\".xml,.pdf,.jpg,.jpeg,.png,.webp,.heic\">\r\n        <div class=\"arquivos\" id=\"arquivos\"></div>\r\n      </div>\r\n\r\n      <button class=\"btn\" type=\"submit\" id=\"btn\">Enviar nota</button>\r\n      <div class=\"recado\" id=\"recado\"></div>\r\n    </form>\r\n  </div>\r\n\r\n  <div id=\"sucesso\" class=\"pronto oculto\">\r\n    <svg class=\"tique\" viewBox=\"0 0 52 52\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\r\n      <circle cx=\"26\" cy=\"26\" r=\"23\"/><path d=\"M16 27l7 7 14-15\"/>\r\n    </svg>\r\n    <h2>Nota recebida</h2>\r\n    <p>Guarde o número do protocolo. Se precisar falar sobre este envio, é por ele que a gente se localiza.</p>\r\n    <div class=\"protocolo\" id=\"protocolo\"></div>\r\n    <button class=\"btn\" type=\"button\" id=\"btnOutra\">Enviar outra nota</button>\r\n  </div>\r\n\r\n  <div class=\"rodape\">\r\n    O conteúdo é cifrado neste dispositivo antes de sair daqui.<br>\r\n    Nem o servidor que recebe consegue ler o que você enviou.\r\n  </div>\r\n\r\n</div>\r\n\r\n<script>\r\nconst CHAVE_PUBLICA = __CHAVE_PUBLICA_JSON__;\r\n// Vazio quando o próprio recebedor serve esta página; URL absoluta quando ela é\r\n// servida pelo site e o envio precisa atravessar para outra origem.\r\nconst BASE = \"\";\r\n// Servida pelo Worker, o código já vem resolvido; servida pelo site, sai da URL.\r\nconst CODIGO = __CODIGO_NA_URL__ || new URLSearchParams(location.search).get('c') || '';\r\n\r\nconst $ = (s) => document.querySelector(s);\r\nconst ALG = { name: 'RSA-OAEP', hash: 'SHA-256' };\r\nconst LIMITE_TOTAL = 20 * 1024 * 1024;\r\n\r\nlet ARQUIVOS = [];\r\n\r\nconst tamanho = (b) =>\r\n  b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';\r\nconst esc = (s) => String(s ?? '').replace(/[&<>\"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;' }[c]));\r\n\r\nfunction b64de(buf) {\r\n  const bytes = new Uint8Array(buf);\r\n  let s = '';\r\n  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));\r\n  return btoa(s);\r\n}\r\n\r\nfunction pintar() {\r\n  $('#arquivos').innerHTML = ARQUIVOS.map((a, i) => `\r\n    <div class=\"arq\">\r\n      <span class=\"n\">${esc(a.name)}</span>\r\n      <span class=\"t\">${tamanho(a.size)}</span>\r\n      <button type=\"button\" data-i=\"${i}\" aria-label=\"remover\">&times;</button>\r\n    </div>`).join('');\r\n  $('#arquivos').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {\r\n    ARQUIVOS.splice(Number(b.dataset.i), 1);\r\n    pintar();\r\n  }));\r\n}\r\n\r\nfunction adicionar(lista) {\r\n  for (const f of lista) {\r\n    if (ARQUIVOS.some((a) => a.name === f.name && a.size === f.size)) continue;\r\n    ARQUIVOS.push(f);\r\n  }\r\n  pintar();\r\n}\r\n\r\n$('#zona').addEventListener('click', () => $('#arquivo').click());\r\n$('#arquivo').addEventListener('change', (e) => { adicionar(e.target.files); e.target.value = ''; });\r\n['dragenter', 'dragover'].forEach((ev) => $('#zona').addEventListener(ev, (e) => {\r\n  e.preventDefault(); $('#zona').classList.add('sobre');\r\n}));\r\n['dragleave', 'drop'].forEach((ev) => $('#zona').addEventListener(ev, (e) => {\r\n  e.preventDefault(); $('#zona').classList.remove('sobre');\r\n}));\r\n$('#zona').addEventListener('drop', (e) => adicionar(e.dataTransfer.files));\r\n['dragover', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault()));\r\n\r\nconst lerB64 = (f) => new Promise((res, rej) => {\r\n  const fr = new FileReader();\r\n  fr.onload = () => res(String(fr.result).split(',')[1]);\r\n  fr.onerror = () => rej(new Error('Não consegui ler ' + f.name));\r\n  fr.readAsDataURL(f);\r\n});\r\n\r\n/**\r\n * Cifra aqui mesmo, no aparelho de quem envia. Sorteia uma chave AES para este\r\n * envio, fecha o conteúdo com ela, e manda a chave AES dentro do RSA — que só a\r\n * chave privada do destinatário abre.\r\n */\r\nasync function empacotar(conteudo) {\r\n  const publica = await crypto.subtle.importKey('jwk', CHAVE_PUBLICA, ALG, false, ['encrypt']);\r\n  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);\r\n  const iv = crypto.getRandomValues(new Uint8Array(12));\r\n  const ct = await crypto.subtle.encrypt(\r\n    { name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(conteudo)),\r\n  );\r\n  const bruta = await crypto.subtle.exportKey('raw', aes);\r\n  return {\r\n    v: 1,\r\n    alg: 'RSA-OAEP-3072+AES-256-GCM',\r\n    chave: b64de(await crypto.subtle.encrypt(ALG, publica, bruta)),\r\n    iv: b64de(iv),\r\n    ct: b64de(ct),\r\n  };\r\n}\r\n\r\nfunction recado(txt, classe = 'neutro') {\r\n  $('#recado').textContent = txt;\r\n  $('#recado').className = 'recado ' + classe;\r\n}\r\n\r\n$('#form').addEventListener('submit', async (e) => {\r\n  e.preventDefault();\r\n  if (!ARQUIVOS.length) return recado('Escolha ao menos um arquivo da nota.', 'ruim');\r\n\r\n  const total = ARQUIVOS.reduce((s, a) => s + a.size, 0);\r\n  if (total > LIMITE_TOTAL) {\r\n    return recado(`Os arquivos somam ${tamanho(total)}. O limite por envio é 20 MB — mande em partes.`, 'ruim');\r\n  }\r\n\r\n  $('#btn').disabled = true;\r\n  recado('Cifrando e enviando…');\r\n\r\n  try {\r\n    const conteudo = {\r\n      metadados: {\r\n        quem: $('#quem').value.trim(),\r\n        contato: $('#contato').value.trim(),\r\n        assunto: $('#assunto').value.trim(),\r\n        valor: $('#valor').value.trim(),\r\n        enviadoEm: new Date().toISOString(),\r\n      },\r\n      arquivos: [],\r\n    };\r\n    for (const f of ARQUIVOS) {\r\n      conteudo.arquivos.push({\r\n        nome: f.name,\r\n        mime: f.type || 'application/octet-stream',\r\n        tamanho: f.size,\r\n        dataB64: await lerB64(f),\r\n      });\r\n    }\r\n\r\n    const pacote = await empacotar(conteudo);\r\n    const r = await fetch(BASE + '/enviar' + (CODIGO ? '?c=' + encodeURIComponent(CODIGO) : ''), {\r\n      method: 'POST',\r\n      headers: { 'content-type': 'application/json' },\r\n      body: JSON.stringify(pacote),\r\n    });\r\n    const resposta = await r.json().catch(() => ({}));\r\n    if (!r.ok || !resposta.ok) throw new Error(resposta.erro || 'Falha no envio. Tente de novo.');\r\n\r\n    $('#protocolo').textContent = resposta.protocolo;\r\n    $('#tela').classList.add('oculto');\r\n    $('#sucesso').classList.remove('oculto');\r\n    window.scrollTo(0, 0);\r\n  } catch (err) {\r\n    recado(err.message, 'ruim');\r\n  } finally {\r\n    $('#btn').disabled = false;\r\n  }\r\n});\r\n\r\n/**\r\n * Só desenha o formulário depois de o recebedor confirmar que o link vale. Assim\r\n * ninguém preenche tudo, anexa os arquivos e descobre no fim que o link expirou.\r\n */\r\n(async function conferirLink() {\r\n  try {\r\n    const r = await fetch(BASE + '/verificar?c=' + encodeURIComponent(CODIGO));\r\n    const j = await r.json();\r\n    $('#carregando').classList.add('oculto');\r\n    if (j.ok) $('#tela').classList.remove('oculto');\r\n    else $('#invalido').classList.remove('oculto');\r\n  } catch {\r\n    // recebedor fora do ar: mostra o formulário assim mesmo, e o envio dirá o que houve\r\n    $('#carregando').classList.add('oculto');\r\n    $('#tela').classList.remove('oculto');\r\n  }\r\n})();\r\n\r\n$('#btnOutra').addEventListener('click', () => {\r\n  ARQUIVOS = [];\r\n  $('#form').reset();\r\n  pintar();\r\n  recado('');\r\n  $('#sucesso').classList.add('oculto');\r\n  $('#tela').classList.remove('oculto');\r\n});\r\n</script>\r\n</body>\r\n</html>\r\n";

// O formulário também é servido pelo site próprio, em /enviar. Como ali ele roda
// em outra origem, o envio precisa ser autorizado explicitamente — e só para essa
// origem, não para qualquer página da internet.
const ORIGEM_SITE = "https://notas.helieagle.com.br";

const LIMITE = 25 * 1024 * 1024;   // 25 MB por envio

const PAGINA_LINK_INVALIDO = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Link inválido</title>
<style>
 body{background:#0a0e13;color:#e4ecf4;font:400 15px/1.6 "Inter",-apple-system,"Segoe UI",Roboto,sans-serif;
      margin:0;display:grid;place-items:center;min-height:100vh;padding:28px;text-align:center}
 .c{max-width:420px} svg{width:44px;height:44px;color:#e8825a;margin-bottom:18px}
 h1{font-size:19px;font-weight:600;margin:0 0 10px}
 p{color:#94a5b8;font-size:14px;margin:0}
</style></head><body><div class="c">
<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
<circle cx="24" cy="24" r="20"/><path d="M24 14v13M24 33v.5"/></svg>
<h1>Este link não vale mais</h1>
<p>Peça um link atualizado a quem solicitou a nota. O endereço muda de tempos em tempos, por segurança.</p>
</div></body></html>`;

const texto = (corpo, codigo = 200, tipo = 'text/plain; charset=utf-8') =>
  new Response(corpo, { status: codigo, headers: { 'content-type': tipo, 'cache-control': 'no-store' } });

const json = (corpo, codigo = 200, extra = {}) =>
  new Response(JSON.stringify(corpo), {
    status: codigo,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

/** Protocolo legível para quem envia e ordenável para quem recebe. */
function novoProtocolo() {
  const d = new Date();
  const p = (n, c = 2) => String(n).padStart(c, '0');
  const sufixo = [...crypto.getRandomValues(new Uint8Array(3))]
    .map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
       + `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${sufixo}`;
}

const admin = (req, env) =>
  Boolean(env.SEGREDO_ADMIN) && req.headers.get('x-heli-admin') === env.SEGREDO_ADMIN;

/** Devolve o cabeçalho de liberação só quando a origem é o site próprio. */
function cors(req) {
  const origem = req.headers.get('origin');
  if (!origem || !ORIGEM_SITE || origem !== ORIGEM_SITE) return {};
  return {
    'access-control-allow-origin': origem,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'vary': 'origin',
  };
}

const codigoConfere = (url, env) => {
  const exigido = (env.CODIGO || '').trim();
  return !exigido || url.searchParams.get('c') === exigido;
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const rota = url.pathname.replace(/\/+$/, '') || '/';

    // ---------------------------------------------------------- CORS e verificação
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(req) });
    }

    // O formulário servido pelo site pergunta aqui se o código vale, antes de
    // se desenhar. Sem isso ele só descobriria no envio, depois de a pessoa ter
    // preenchido tudo.
    if (rota === '/verificar' && req.method === 'GET') {
      return json({ ok: codigoConfere(url, env) }, 200, cors(req));
    }

    // ---------------------------------------------------------- página pública
    if (rota === '/' && req.method === 'GET') {
      // O código é conferido já na abertura. Antes ele só era verificado no
      // envio, e quem chegasse com um link velho preenchia tudo, anexava os
      // arquivos e só então era barrado — perdendo o que tinha feito.
      if (!codigoConfere(url, env)) return texto(PAGINA_LINK_INVALIDO, 403, 'text/html; charset=utf-8');

      const html = PAGINA
        .replace('__CHAVE_PUBLICA_JSON__', JSON.stringify(CHAVE_PUBLICA))
        .replace('__CODIGO_NA_URL__', JSON.stringify(url.searchParams.get('c') || ''));
      return texto(html, 200, 'text/html; charset=utf-8');
    }

    // ---------------------------------------------------------- envio
    if (rota === '/enviar' && req.method === 'POST') {
      const h = cors(req);
      if (!env.ENVIOS) return json({ erro: 'Recebedor sem armazenamento configurado.' }, 500, h);

      // O código vive no link divulgado. Não é segredo criptográfico — serve só
      // para que o endereço, se descoberto por acaso, não vire caixa de spam.
      if (!codigoConfere(url, env)) {
        return json({ erro: 'Link inválido ou expirado. Peça um link novo a quem solicitou a nota.' }, 403, h);
      }

      const tamanho = Number(req.headers.get('content-length') || 0);
      if (tamanho > LIMITE) {
        return json({ erro: 'Envio acima de 25 MB. Mande os arquivos em partes.' }, 413, h);
      }
      if (!tamanho) return json({ erro: 'Envio vazio.' }, 400, h);

      const protocolo = novoProtocolo();
      // gravado exatamente como chegou: nenhum parse, nenhuma leitura
      await env.ENVIOS.put(`envios/${protocolo}.json`, req.body, {
        httpMetadata: { contentType: 'application/octet-stream' },
        customMetadata: { recebidoEm: new Date().toISOString() },
      });
      return json({ ok: true, protocolo }, 200, h);
    }

    // ---------------------------------------------------------- área do painel
    if (rota.startsWith('/api/')) {
      if (!admin(req, env)) return json({ erro: 'Não autorizado.' }, 401);
      if (!env.ENVIOS) return json({ erro: 'Sem armazenamento configurado.' }, 500);

      if (rota === '/api/listar') {
        const lista = await env.ENVIOS.list({ prefix: 'envios/', limit: 500 });
        return json({
          itens: lista.objects.map((o) => ({
            chave: o.key,
            protocolo: o.key.replace(/^envios\//, '').replace(/\.json$/, ''),
            tamanho: o.size,
            recebidoEm: o.customMetadata?.recebidoEm || o.uploaded,
          })).sort((a, b) => String(a.recebidoEm).localeCompare(String(b.recebidoEm))),
        });
      }

      if (rota === '/api/baixar') {
        const chave = url.searchParams.get('chave') || '';
        if (!chave.startsWith('envios/')) return json({ erro: 'Chave inválida.' }, 400);
        const obj = await env.ENVIOS.get(chave);
        if (!obj) return json({ erro: 'Envio não encontrado.' }, 404);
        return new Response(obj.body, {
          headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' },
        });
      }

      if (rota === '/api/apagar' && req.method === 'POST') {
        const chave = url.searchParams.get('chave') || '';
        if (!chave.startsWith('envios/')) return json({ erro: 'Chave inválida.' }, 400);
        await env.ENVIOS.delete(chave);
        return json({ ok: true });
      }

      return json({ erro: 'Rota desconhecida.' }, 404);
    }

    return texto('Não encontrado.', 404);
  },
};
