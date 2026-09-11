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
const PAGINA = "<!doctype html>\n<html lang=\"pt-BR\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"robots\" content=\"noindex, nofollow\">\n<title>Envio de nota fiscal</title>\n<style>\n  :root {\n    --bg: #0a0e13; --painel: #111820; --painel2: #161f29;\n    --linha: #1f2b38; --txt: #e4ecf4; --txt2: #94a5b8; --txt3: #5f7186;\n    --acento: #f2a950; --acento-dim: #7a5827; --ok: #4ec9a0; --alerta: #e8825a;\n    --sans: \"Inter\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n    --mono: ui-monospace, \"Cascadia Mono\", Menlo, Consolas, monospace;\n  }\n  * { box-sizing: border-box; }\n  html, body { margin: 0; padding: 0; }\n  body {\n    background: var(--bg); color: var(--txt);\n    font: 400 15px/1.6 var(--sans); -webkit-font-smoothing: antialiased;\n    padding: 28px 20px 70px;\n  }\n  .folha { max-width: 540px; margin: 0 auto; }\n\n  header { text-align: center; margin-bottom: 28px; }\n  .marca { width: 42px; height: 42px; color: var(--acento); margin: 0 auto 14px; display: block; }\n  h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 6px; }\n  .org { font-size: 13px; color: var(--txt3); }\n\n  .nota {\n    background: var(--painel); border: 1px solid var(--linha);\n    border-radius: 10px; padding: 14px 17px; margin-bottom: 24px;\n    font-size: 13px; color: var(--txt2); line-height: 1.65;\n  }\n  .nota b { color: var(--txt); font-weight: 600; }\n\n  label { display: block; font-size: 12px; color: var(--txt3); margin: 0 0 6px; }\n  label .obr { color: var(--acento); }\n  .campo { margin-bottom: 17px; }\n  input, textarea {\n    width: 100%; background: var(--painel2); border: 1px solid var(--linha);\n    color: var(--txt); border-radius: 9px; padding: 12px 13px;\n    font: inherit; outline: none; transition: border-color .15s;\n  }\n  input:focus, textarea:focus { border-color: var(--acento-dim); }\n  input::placeholder, textarea::placeholder { color: #47576a; }\n  textarea { resize: vertical; min-height: 78px; }\n\n  .zona {\n    border: 1px dashed var(--linha); border-radius: 10px;\n    padding: 26px 18px; text-align: center; color: var(--txt3);\n    font-size: 14px; cursor: pointer; transition: border-color .15s, background .15s;\n  }\n  .zona:hover, .zona.sobre { border-color: var(--acento-dim); background: var(--painel2); color: var(--txt2); }\n  .zona b { color: var(--txt2); font-weight: 500; display: block; margin-bottom: 3px; }\n  .zona small { font-size: 12px; }\n\n  .arquivos { margin-top: 11px; display: flex; flex-direction: column; gap: 7px; }\n  .arq {\n    display: flex; align-items: center; gap: 10px;\n    background: var(--painel2); border: 1px solid var(--linha);\n    border-radius: 8px; padding: 9px 10px 9px 13px; font-size: 13px; color: var(--txt2);\n  }\n  .arq .n { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n  .arq .t { color: var(--txt3); font-size: 12px; }\n  .arq button {\n    background: transparent; border: 0; color: var(--txt3);\n    font-size: 17px; line-height: 1; padding: 3px 6px; border-radius: 5px; cursor: pointer;\n  }\n  .arq button:hover { color: var(--alerta); background: #1d1210; }\n\n  .btn {\n    width: 100%; background: var(--acento); color: #171104; border: 0;\n    border-radius: 9px; padding: 14px; font: 600 15px var(--sans);\n    cursor: pointer; margin-top: 8px; transition: opacity .15s;\n  }\n  .btn:hover:not(:disabled) { opacity: .9; }\n  .btn:disabled { opacity: .45; cursor: default; }\n\n  .recado { margin-top: 15px; font-size: 13.5px; min-height: 20px; }\n  .recado.ruim { color: var(--alerta); }\n  .recado.neutro { color: var(--txt3); }\n\n  .pronto { text-align: center; padding: 22px 0; }\n  .pronto .tique {\n    width: 52px; height: 52px; margin: 0 auto 18px; display: block; color: var(--ok);\n  }\n  .pronto h2 { font-size: 18px; font-weight: 600; margin: 0 0 8px; }\n  .pronto p { color: var(--txt2); font-size: 14px; margin: 0 0 20px; }\n  .protocolo {\n    font-family: var(--mono); font-size: 15px; color: var(--acento);\n    background: var(--painel2); border: 1px solid var(--acento-dim);\n    border-radius: 9px; padding: 13px; margin-bottom: 22px; word-break: break-all;\n  }\n  .rodape {\n    margin-top: 30px; text-align: center;\n    font-size: 11.5px; color: var(--txt3); line-height: 1.7;\n  }\n  .oculto { display: none !important; }\n</style>\n</head>\n<body>\n<div class=\"folha\">\n\n  <header>\n    <svg class=\"marca\" viewBox=\"0 0 48 48\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <path d=\"M6 12h36M24 12v5\"/>\n      <path d=\"M13 22h16a5 5 0 0 1 5 5v4H18a5 5 0 0 1-5-5v-4Z\"/>\n      <path d=\"M34 27h6l-3 4h-3M16 31v5M13 36h8\"/>\n    </svg>\n    <h1>Envio de nota fiscal</h1>\n    <div class=\"org\">Heli Eagle</div>\n  </header>\n\n  <div id=\"tela\">\n    <div class=\"nota\">\n      Envie aqui a nota referente ao serviço ou produto fornecido.\n      <b>Se você tiver o arquivo XML da nota, mande ele</b> — é o que evita erro de digitação\n      no nosso lado. Não tendo, o PDF ou uma foto legível resolvem.\n    </div>\n\n    <form id=\"form\" autocomplete=\"off\">\n      <div class=\"campo\">\n        <label for=\"quem\">Seu nome ou o da empresa <span class=\"obr\">*</span></label>\n        <input type=\"text\" id=\"quem\" required placeholder=\"Aviation Fuel Services Ltda\">\n      </div>\n\n      <div class=\"campo\">\n        <label for=\"contato\">E-mail ou telefone <span style=\"opacity:.7\">— caso precisemos confirmar algo</span></label>\n        <input type=\"text\" id=\"contato\" placeholder=\"financeiro@empresa.com.br\">\n      </div>\n\n      <div class=\"campo\">\n        <label for=\"assunto\">Do que se trata <span class=\"obr\">*</span></label>\n        <textarea id=\"assunto\" required placeholder=\"Abastecimento do dia 08/09, NF-e 12014\"></textarea>\n      </div>\n\n      <div class=\"campo\">\n        <label for=\"valor\">Valor <span style=\"opacity:.7\">— se souber</span></label>\n        <input type=\"text\" id=\"valor\" inputmode=\"decimal\" placeholder=\"7.431,90\">\n      </div>\n\n      <div class=\"campo\">\n        <label>Arquivos <span class=\"obr\">*</span></label>\n        <div class=\"zona\" id=\"zona\">\n          <b>Toque para escolher a nota</b>\n          <small>XML, PDF ou foto · pode mandar mais de um</small>\n        </div>\n        <input type=\"file\" id=\"arquivo\" multiple class=\"oculto\"\n               accept=\".xml,.pdf,.jpg,.jpeg,.png,.webp,.heic\">\n        <div class=\"arquivos\" id=\"arquivos\"></div>\n      </div>\n\n      <button class=\"btn\" type=\"submit\" id=\"btn\">Enviar nota</button>\n      <div class=\"recado\" id=\"recado\"></div>\n    </form>\n  </div>\n\n  <div id=\"sucesso\" class=\"pronto oculto\">\n    <svg class=\"tique\" viewBox=\"0 0 52 52\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n      <circle cx=\"26\" cy=\"26\" r=\"23\"/><path d=\"M16 27l7 7 14-15\"/>\n    </svg>\n    <h2>Nota recebida</h2>\n    <p>Guarde o número do protocolo. Se precisar falar sobre este envio, é por ele que a gente se localiza.</p>\n    <div class=\"protocolo\" id=\"protocolo\"></div>\n    <button class=\"btn\" type=\"button\" id=\"btnOutra\">Enviar outra nota</button>\n  </div>\n\n  <div class=\"rodape\">\n    O conteúdo é cifrado neste dispositivo antes de sair daqui.<br>\n    Nem o servidor que recebe consegue ler o que você enviou.\n  </div>\n\n</div>\n\n<script>\nconst CHAVE_PUBLICA = __CHAVE_PUBLICA_JSON__;\nconst CODIGO = __CODIGO_NA_URL__;\n\nconst $ = (s) => document.querySelector(s);\nconst ALG = { name: 'RSA-OAEP', hash: 'SHA-256' };\nconst LIMITE_TOTAL = 20 * 1024 * 1024;\n\nlet ARQUIVOS = [];\n\nconst tamanho = (b) =>\n  b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';\nconst esc = (s) => String(s ?? '').replace(/[&<>\"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;' }[c]));\n\nfunction b64de(buf) {\n  const bytes = new Uint8Array(buf);\n  let s = '';\n  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));\n  return btoa(s);\n}\n\nfunction pintar() {\n  $('#arquivos').innerHTML = ARQUIVOS.map((a, i) => `\n    <div class=\"arq\">\n      <span class=\"n\">${esc(a.name)}</span>\n      <span class=\"t\">${tamanho(a.size)}</span>\n      <button type=\"button\" data-i=\"${i}\" aria-label=\"remover\">&times;</button>\n    </div>`).join('');\n  $('#arquivos').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {\n    ARQUIVOS.splice(Number(b.dataset.i), 1);\n    pintar();\n  }));\n}\n\nfunction adicionar(lista) {\n  for (const f of lista) {\n    if (ARQUIVOS.some((a) => a.name === f.name && a.size === f.size)) continue;\n    ARQUIVOS.push(f);\n  }\n  pintar();\n}\n\n$('#zona').addEventListener('click', () => $('#arquivo').click());\n$('#arquivo').addEventListener('change', (e) => { adicionar(e.target.files); e.target.value = ''; });\n['dragenter', 'dragover'].forEach((ev) => $('#zona').addEventListener(ev, (e) => {\n  e.preventDefault(); $('#zona').classList.add('sobre');\n}));\n['dragleave', 'drop'].forEach((ev) => $('#zona').addEventListener(ev, (e) => {\n  e.preventDefault(); $('#zona').classList.remove('sobre');\n}));\n$('#zona').addEventListener('drop', (e) => adicionar(e.dataTransfer.files));\n['dragover', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault()));\n\nconst lerB64 = (f) => new Promise((res, rej) => {\n  const fr = new FileReader();\n  fr.onload = () => res(String(fr.result).split(',')[1]);\n  fr.onerror = () => rej(new Error('Não consegui ler ' + f.name));\n  fr.readAsDataURL(f);\n});\n\n/**\n * Cifra aqui mesmo, no aparelho de quem envia. Sorteia uma chave AES para este\n * envio, fecha o conteúdo com ela, e manda a chave AES dentro do RSA — que só a\n * chave privada do destinatário abre.\n */\nasync function empacotar(conteudo) {\n  const publica = await crypto.subtle.importKey('jwk', CHAVE_PUBLICA, ALG, false, ['encrypt']);\n  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);\n  const iv = crypto.getRandomValues(new Uint8Array(12));\n  const ct = await crypto.subtle.encrypt(\n    { name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(conteudo)),\n  );\n  const bruta = await crypto.subtle.exportKey('raw', aes);\n  return {\n    v: 1,\n    alg: 'RSA-OAEP-3072+AES-256-GCM',\n    chave: b64de(await crypto.subtle.encrypt(ALG, publica, bruta)),\n    iv: b64de(iv),\n    ct: b64de(ct),\n  };\n}\n\nfunction recado(txt, classe = 'neutro') {\n  $('#recado').textContent = txt;\n  $('#recado').className = 'recado ' + classe;\n}\n\n$('#form').addEventListener('submit', async (e) => {\n  e.preventDefault();\n  if (!ARQUIVOS.length) return recado('Escolha ao menos um arquivo da nota.', 'ruim');\n\n  const total = ARQUIVOS.reduce((s, a) => s + a.size, 0);\n  if (total > LIMITE_TOTAL) {\n    return recado(`Os arquivos somam ${tamanho(total)}. O limite por envio é 20 MB — mande em partes.`, 'ruim');\n  }\n\n  $('#btn').disabled = true;\n  recado('Cifrando e enviando…');\n\n  try {\n    const conteudo = {\n      metadados: {\n        quem: $('#quem').value.trim(),\n        contato: $('#contato').value.trim(),\n        assunto: $('#assunto').value.trim(),\n        valor: $('#valor').value.trim(),\n        enviadoEm: new Date().toISOString(),\n      },\n      arquivos: [],\n    };\n    for (const f of ARQUIVOS) {\n      conteudo.arquivos.push({\n        nome: f.name,\n        mime: f.type || 'application/octet-stream',\n        tamanho: f.size,\n        dataB64: await lerB64(f),\n      });\n    }\n\n    const pacote = await empacotar(conteudo);\n    const r = await fetch('/enviar' + (CODIGO ? '?c=' + encodeURIComponent(CODIGO) : ''), {\n      method: 'POST',\n      headers: { 'content-type': 'application/json' },\n      body: JSON.stringify(pacote),\n    });\n    const resposta = await r.json().catch(() => ({}));\n    if (!r.ok || !resposta.ok) throw new Error(resposta.erro || 'Falha no envio. Tente de novo.');\n\n    $('#protocolo').textContent = resposta.protocolo;\n    $('#tela').classList.add('oculto');\n    $('#sucesso').classList.remove('oculto');\n    window.scrollTo(0, 0);\n  } catch (err) {\n    recado(err.message, 'ruim');\n  } finally {\n    $('#btn').disabled = false;\n  }\n});\n\n$('#btnOutra').addEventListener('click', () => {\n  ARQUIVOS = [];\n  $('#form').reset();\n  pintar();\n  recado('');\n  $('#sucesso').classList.add('oculto');\n  $('#tela').classList.remove('oculto');\n});\n</script>\n</body>\n</html>\n";

const LIMITE = 25 * 1024 * 1024;   // 25 MB por envio

const texto = (corpo, codigo = 200, tipo = 'text/plain; charset=utf-8') =>
  new Response(corpo, { status: codigo, headers: { 'content-type': tipo, 'cache-control': 'no-store' } });

const json = (corpo, codigo = 200) =>
  new Response(JSON.stringify(corpo), {
    status: codigo,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const rota = url.pathname.replace(/\/+$/, '') || '/';

    // ---------------------------------------------------------- página pública
    if (rota === '/' && req.method === 'GET') {
      const html = PAGINA
        .replace('__CHAVE_PUBLICA_JSON__', JSON.stringify(CHAVE_PUBLICA))
        .replace('__CODIGO_NA_URL__', JSON.stringify(url.searchParams.get('c') || ''));
      return texto(html, 200, 'text/html; charset=utf-8');
    }

    // ---------------------------------------------------------- envio
    if (rota === '/enviar' && req.method === 'POST') {
      if (!env.ENVIOS) return json({ erro: 'Recebedor sem armazenamento configurado.' }, 500);

      // O código vive no link divulgado. Não é segredo criptográfico — serve só
      // para que o endereço, se descoberto por acaso, não vire caixa de spam.
      const exigido = (env.CODIGO || '').trim();
      if (exigido && url.searchParams.get('c') !== exigido) {
        return json({ erro: 'Link inválido ou expirado. Peça um link novo a quem solicitou a nota.' }, 403);
      }

      const tamanho = Number(req.headers.get('content-length') || 0);
      if (tamanho > LIMITE) {
        return json({ erro: 'Envio acima de 25 MB. Mande os arquivos em partes.' }, 413);
      }
      if (!tamanho) return json({ erro: 'Envio vazio.' }, 400);

      const protocolo = novoProtocolo();
      // gravado exatamente como chegou: nenhum parse, nenhuma leitura
      await env.ENVIOS.put(`envios/${protocolo}.json`, req.body, {
        httpMetadata: { contentType: 'application/octet-stream' },
        customMetadata: { recebidoEm: new Date().toISOString() },
      });
      return json({ ok: true, protocolo });
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
