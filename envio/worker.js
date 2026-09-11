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

const CHAVE_PUBLICA = __CHAVE_PUBLICA__;
const PAGINA = __HTML__;

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
