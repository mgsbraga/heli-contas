/**
 * Leitura determinística de nota fiscal — sem IA, sem OCR, sem chute.
 *
 * Três fontes, em ordem de confiabilidade:
 *   1. XML da nota          → todos os campos, exatos
 *   2. chave de acesso      → CNPJ, data, série e número saem dos próprios dígitos
 *   3. QR / código de barras → devolve a chave, que cai no caminho 2
 *
 * Nada aqui adivinha. Quando um campo não é encontrado, ele volta vazio para você
 * preencher — nunca preenchido com uma aproximação.
 */
import zlib from 'node:zlib';

// ---------------------------------------------------------------- chave de acesso

export const UF_POR_CODIGO = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
  41: 'PR', 42: 'SC', 43: 'RS',
  50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

export const MODELOS = {
  55: 'NF-e', 65: 'NFC-e', 57: 'CT-e', 58: 'MDF-e', 59: 'SAT', 67: 'CT-e OS',
};

/**
 * Dígito verificador da chave: módulo 11 sobre os 43 primeiros dígitos, com pesos
 * 2 a 9 repetindo da direita para a esquerda. Resto 0 ou 1 resulta em dígito 0.
 */
export function dvDaChave(digitos43) {
  let soma = 0;
  let peso = 2;
  for (let i = digitos43.length - 1; i >= 0; i--) {
    soma += Number(digitos43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto <= 1 ? 0 : 11 - resto;
}

const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');

export const formatarCnpj = (c) => {
  const d = soDigitos(c);
  return d.length === 14
    ? `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
    : d;
};

/**
 * Desmonta os 44 dígitos. Devolve null se não for uma chave; devolve o objeto com
 * `valida: false` se os dígitos existem mas o verificador não bate (erro de digitação).
 */
export function lerChave(entrada) {
  const d = soDigitos(entrada);
  if (d.length !== 44) return null;

  const cUF = Number(d.slice(0, 2));
  const aa = d.slice(2, 4);
  const mm = d.slice(4, 6);
  const cnpj = d.slice(6, 20);
  const modelo = Number(d.slice(20, 22));
  const serie = Number(d.slice(22, 25));
  const numero = Number(d.slice(25, 34));
  const tpEmis = Number(d.slice(34, 35));
  const cNF = d.slice(35, 43);
  const dv = Number(d.slice(43));

  return {
    chave: d,
    valida: dv === dvDaChave(d.slice(0, 43)),
    uf: UF_POR_CODIGO[cUF] || null,
    cUF,
    competencia: `20${aa}-${mm}`,          // a chave só carrega ano e mês
    cnpjEmitente: cnpj,
    modelo,
    modeloNome: MODELOS[modelo] || `modelo ${modelo}`,
    serie,
    numero,
    tpEmis,
    cNF,
    dv,
  };
}

/** Encontra uma chave num texto qualquer, tolerando espaços entre os dígitos. */
export function acharChaveEmTexto(texto) {
  const t = String(texto ?? '');
  // primeiro tenta o formato do DANFE, em grupos de quatro
  const agrupada = t.match(/\b(?:\d{4}[ .]){10}\d{4}\b/);
  if (agrupada) {
    const c = lerChave(agrupada[0]);
    if (c?.valida) return c;
  }
  for (const m of t.matchAll(/\d{44}/g)) {
    const c = lerChave(m[0]);
    if (c?.valida) return c;
  }
  // por último, aceita uma chave com verificador errado, para poder avisar
  const qualquer = t.match(/\d{44}/) || t.match(/\b(?:\d{4}[ .]){10}\d{4}\b/);
  return qualquer ? lerChave(qualquer[0]) : null;
}

// ---------------------------------------------------------------- XML

// Busca o conteúdo da primeira tag com um dos nomes dados, ignorando namespace.
function tag(xml, ...nomes) {
  for (const nome of nomes) {
    const re = new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`, 'i');
    const m = xml.match(re);
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
}

// Igual ao anterior, mas restrito ao trecho de um bloco (ex.: só dentro de <emit>).
function bloco(xml, ...nomes) {
  for (const nome of nomes) {
    const re = new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`, 'i');
    const m = xml.match(re);
    if (m) return m[1];
  }
  return '';
}

const numero = (s) => {
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const soData = (s) => {
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};

/**
 * Extrai os campos de um XML de nota. Cobre NF-e/NFC-e (layout nacional da SEFAZ),
 * NFS-e no padrão nacional e o layout ABRASF ainda usado por parte dos municípios.
 * Cada campo é procurado por vários nomes de tag porque os três layouts divergem.
 */
export function lerXmlNota(texto) {
  const xml = String(texto ?? '');
  if (!/<\s*(?:\w+:)?(NFe|nfeProc|NFSe|CompNfse|Nfse|ConsultarNfseResposta|infNFe|infNFSe)\b/i.test(xml)) {
    return null;
  }

  const achado = {};

  // --- chave de acesso: vem no atributo Id (NFe<44>) ou numa tag própria
  // o atributo aparece com aspas duplas ou simples, conforme quem gerou o arquivo
  const idAttr = xml.match(/\bId\s*=\s*["'](?:NFe|NFS)?([0-9]{44})["']/i);
  let chave = idAttr ? lerChave(idAttr[1]) : null;
  if (!chave) {
    const t = tag(xml, 'chNFe', 'chaveAcesso', 'ChaveAcesso', 'chNFSe');
    if (t) chave = lerChave(t);
  }

  // --- emitente / prestador
  const emit = bloco(xml, 'emit', 'PrestadorServico', 'Prestador', 'prest');
  achado.cnpjEmitente = soDigitos(tag(emit || xml, 'CNPJ', 'Cnpj', 'CpfCnpj') || (chave?.cnpjEmitente ?? ''));
  achado.nomeEmitente = tag(emit || xml, 'xNome', 'RazaoSocial', 'xNomePrestador', 'NomeFantasia');

  // --- identificação do documento
  const ide = bloco(xml, 'ide', 'IdentificacaoNfse', 'InfNfse', 'infNFSe');
  achado.numero = tag(ide || xml, 'nNF', 'Numero', 'nNFSe', 'numeroNfse') || (chave ? String(chave.numero) : '');
  achado.serie = tag(ide || xml, 'serie', 'Serie', 'SerieRps') || (chave ? String(chave.serie) : '');
  achado.data = soData(tag(ide || xml, 'dhEmi', 'dEmi', 'DataEmissao', 'dhProc', 'dCompet', 'Competencia'));

  // --- modelo do documento
  const mod = Number(tag(ide || xml, 'mod', 'modelo'));
  achado.modelo = MODELOS[mod] || (chave ? chave.modeloNome : '')
    || (/NFSe|Nfse/i.test(xml) ? 'NFS-e' : '');

  // --- valor: total da NF-e, ou líquido/serviços na NFS-e
  const valores = bloco(xml, 'ICMSTot', 'valores', 'Valores', 'total');
  achado.valor = numero(
    tag(valores || xml, 'vNF', 'vLiq', 'ValorLiquidoNfse', 'ValorServicos', 'vServ', 'vTotal', 'ValorTotal')
  );

  achado.descricao = tag(xml, 'natOp', 'Discriminacao', 'xDescServ', 'discriminacao')
    .replace(/\s+/g, ' ').slice(0, 200);

  return {
    origem: 'xml',
    chave: chave?.chave || '',
    chaveValida: chave ? chave.valida : null,
    cnpjEmitente: achado.cnpjEmitente,
    cnpjFormatado: formatarCnpj(achado.cnpjEmitente),
    nomeEmitente: achado.nomeEmitente,
    modelo: achado.modelo,
    numero: achado.numero,
    serie: achado.serie,
    data: achado.data || (chave ? '' : ''),
    competencia: chave?.competencia || '',
    valor: achado.valor,
    descricao: achado.descricao,
  };
}

// ---------------------------------------------------------------- PDF

/**
 * Procura a chave de acesso na camada de texto de um PDF (o DANFE a imprime por
 * extenso). Os fluxos costumam vir comprimidos com Flate, que o Node descomprime
 * nativamente. Não é OCR: se o PDF for imagem pura, isto não acha nada — e é para
 * esse caso que existe a leitura do QR Code.
 */
export function chaveDePdf(buffer) {
  const bruto = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // 1) alguns PDFs trazem o texto sem compressão
  const direto = acharChaveEmTexto(bruto.toString('latin1'));
  if (direto?.valida) return direto;

  // 2) descomprime cada fluxo e procura em cada um
  const pedacos = [];
  const marca = Buffer.from('stream');
  let i = 0;
  while ((i = bruto.indexOf(marca, i)) !== -1) {
    let ini = i + marca.length;
    if (bruto[ini] === 0x0d) ini++;
    if (bruto[ini] === 0x0a) ini++;
    const fim = bruto.indexOf(Buffer.from('endstream'), ini);
    if (fim === -1) break;
    try {
      pedacos.push(zlib.inflateSync(bruto.subarray(ini, fim)).toString('latin1'));
    } catch { /* fluxo não-Flate (imagem, fonte): ignora */ }
    i = fim;
  }

  const texto = pedacos.join('\n');

  // O texto vem partido em operadores Tj/TJ. Duas formas de escrita convivem:
  //   (assim)Tj                       — string literal
  //   <41424344>Tj                    — string em hexadecimal
  // e o ajuste de espaçamento parte a linha no meio: (430) -250 (1712) TJ
  const literal = texto.replace(/\)\s*-?[\d.]*\s*\(/g, '').replace(/[()]/g, '');
  const hex = texto.replace(/<([0-9A-Fa-f\s]+)>/g, (_, h) => {
    const limpo = h.replace(/\s/g, '');
    let s = '';
    for (let k = 0; k + 1 < limpo.length; k += 2) s += String.fromCharCode(parseInt(limpo.substr(k, 2), 16));
    return s;
  });

  // Uma variante pode produzir 44 dígitos por acaso — os próprios bytes do
  // hexadecimal, por exemplo. Por isso o critério é o dígito verificador, não a
  // ordem: vale a primeira chave que valida, e só se nenhuma validar é que
  // devolvemos uma candidata inválida, para poder avisar o usuário.
  const candidatas = [literal, hex, texto].map(acharChaveEmTexto).filter(Boolean);
  return candidatas.find((c) => c.valida) || candidatas[0] || direto;
}

/** Devolve todo o texto legível de um PDF — usado só para diagnóstico. */
export function textoDePdf(buffer) {
  const bruto = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const partes = [];
  const marca = Buffer.from('stream');
  let i = 0;
  while ((i = bruto.indexOf(marca, i)) !== -1) {
    let ini = i + marca.length;
    if (bruto[ini] === 0x0d) ini++;
    if (bruto[ini] === 0x0a) ini++;
    const fim = bruto.indexOf(Buffer.from('endstream'), ini);
    if (fim === -1) break;
    try { partes.push(zlib.inflateSync(bruto.subarray(ini, fim)).toString('latin1')); } catch {}
    i = fim;
  }
  return partes.join('\n');
}

// ---------------------------------------------------------------- fachada

/**
 * Recebe um arquivo e devolve o que conseguiu apurar, dizendo de onde veio cada
 * coisa. `campos` traz só o que foi realmente lido — o resto fica para o humano.
 */
export function lerNota({ nome = '', mime = '', bytes = null, chaveManual = '' }) {
  if (chaveManual) {
    const c = lerChave(chaveManual);
    return c ? { ...deChave(c), origem: 'chave' } : { origem: 'chave', erro: 'A chave precisa ter 44 dígitos.' };
  }

  const ehXml = /\.xml$/i.test(nome) || /xml/i.test(mime);
  if (ehXml && bytes) {
    const r = lerXmlNota(Buffer.from(bytes).toString('utf8'));
    if (r) return r;
    return { origem: 'xml', erro: 'Este XML não parece ser de uma nota fiscal.' };
  }

  if (/\.pdf$/i.test(nome) || /pdf/i.test(mime)) {
    const c = bytes ? chaveDePdf(Buffer.from(bytes)) : null;
    if (c) return { ...deChave(c), origem: 'pdf' };
    return { origem: 'pdf', erro: 'Não achei a chave de acesso no texto deste PDF. Se ele for uma imagem escaneada, use a foto para ler o QR Code, ou cole a chave à mão.' };
  }

  return { origem: 'nenhuma', erro: 'Formato sem leitura automática. Anexe o XML da nota ou cole a chave de acesso.' };
}

function deChave(c) {
  return {
    chave: c.chave,
    chaveValida: c.valida,
    cnpjEmitente: c.cnpjEmitente,
    cnpjFormatado: formatarCnpj(c.cnpjEmitente),
    nomeEmitente: '',
    modelo: c.modeloNome,
    numero: String(c.numero),
    serie: String(c.serie),
    data: '',
    competencia: c.competencia,
    uf: c.uf,
    valor: null,
    descricao: '',
  };
}
