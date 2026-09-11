# Prestação de contas — operação de táxi aéreo

Sistema de prestação de contas hospedado no GitHub Pages, com acesso por senha.
Você alimenta pelo PC; sócio e contador consultam pelo navegador.

---

## Como funciona

O repositório é público, mas **nenhum dado financeiro é legível nele**. Todo o ledger —
valores, fornecedores, CNPJ, número da nota, quem pagou — e todas as notas fiscais
anexadas são gravados cifrados com **AES-256-GCM**. A chave é derivada da senha por
PBKDF2-SHA256 com 600.000 iterações, dentro do navegador de quem acessa.

A senha nunca é enviada a servidor algum. Não existe backend: o GitHub serve só
arquivos estáticos e bytes cifrados.

### Dois níveis de acesso

| Senha | O que abre |
|---|---|
| **TOTAL** | Tudo: cada lançamento, fornecedor, CNPJ, nº da nota, quem pagou, forma de pagamento e os PDFs das notas fiscais. |
| **RESUMO** | Só os totais consolidados — por categoria, por mês, por pagador, mais o acerto entre sócios. Sem fornecedor, sem nota, sem descrição individual, sem anexos. |

Os dois níveis usam **chaves e arquivos separados**. A senha de resumo é
matematicamente incapaz de abrir o ledger completo ou qualquer nota fiscal — não é
uma restrição de interface, é criptografia.

### O que fica no repositório

```
docs/
  index.html          visualizador (código, sem dado nenhum)
  crypto.mjs          rotinas de cifra
  data/
    meta.json         só: nome da operação, data do build, os dois salts
    ledger.enc        ledger completo      → abre com a senha TOTAL
    resumo.enc        totais consolidados  → abre com a senha RESUMO
    nf/*.enc          notas fiscais        → abrem com a senha TOTAL
```

### O que nunca entra no repositório

A pasta `local/` está no `.gitignore` e é a única cópia em claro:

```
local/
  ledger.json         o ledger legível — sua fonte de verdade
  segredos.json       as duas senhas
  nf/                 as notas fiscais originais
```

O `painel/` é só código de interface, sem dado nenhum, e nunca é servido pelo site
público — ele existe apenas para o servidor local.

---

## Uso no dia a dia — o painel

Dois cliques em **`painel.bat`** (ou `node heli.mjs painel`). Abre uma página no seu
navegador com o formulário de lançamento.

Nela você:

- preenche os campos lado a lado, com data em calendário e categoria, pagador e forma
  em listas que aceitam valor novo digitado na hora;
- **arrasta o PDF ou a foto da nota** para dentro da página — vários por lançamento;
- escolhe como dividir a despesa entre os sócios;
- vê a lista do que já foi lançado, com **Editar** e **Apagar** em cada linha;
- acompanha o acerto entre sócios atualizado a cada gravação;
- clica em **Publicar** quando quiser subir. O selo no topo avisa quando há
  alterações pendentes.

O painel roda na sua máquina e só aceita conexão dela mesma. Os dados em claro não
saem do PC: a página conversa com o processo local, que grava em `local/` e publica
cifrado — exatamente o que o terminal faz.

Feche pelo botão **Fechar** na página ou com Ctrl+C na janela preta que abriu junto.

### Ainda dá para usar o terminal

```powershell
node heli.mjs add
```

Mesmo resultado, por perguntas: data, descrição, categoria, fornecedor, CNPJ, tipo e
número do documento, valor, quem pagou, forma, status, rateio e o caminho da nota —
pode arrastar o arquivo para dentro da janela do terminal.

---

## Caixa de entrada — notas de outras pessoas

Você é o único que publica, mas não precisa ser o único que junta as notas.

Aponte o painel para uma pasta e qualquer coisa depositada nela aparece na
**Caixa de entrada**, já lida, esperando sua conferência. Nada entra no ledger sem
você mandar lançar.

```
node heli.mjs painel   →   Caixa de entrada   →   informe o caminho da pasta
```

### Como as outras pessoas depositam

Use uma pasta do OneDrive e compartilhe conforme quem vai mandar:

- **Sócios e pessoas de confiança** — compartilhe a pasta com edição. Eles largam o
  XML ou a foto de onde estiverem, inclusive pelo aplicativo do celular.
- **Fornecedores e terceiros** — use o recurso *Solicitar arquivos* do OneDrive, que
  gera um link de envio: quem tem o link consegue mandar arquivo, mas não consegue
  ver o que já está lá. Ninguém precisa de conta nem de senha do sistema.

### O que acontece com cada arquivo

O painel lista o que chegou, com tamanho e data de recebimento, e já aplica a leitura
automática — em XML e PDF na hora, e no caso de imagem lê o QR Code quando você clica
em Lançar. Arquivos que não sejam nota (`.docx`, planilha, etc.) são simplesmente
ignorados.

Em cada item você tem três saídas:

| Botão | O que faz |
|---|---|
| **ver** | Abre o arquivo para você conferir antes de decidir |
| **Lançar** | Leva para o formulário, já anexado e preenchido com o que deu para ler |
| **Descartar** | Tira da fila sem lançar |

**Nada é apagado.** Depois de lançado, o original vai para a subpasta `processadas`;
descartado, vai para `descartadas`. A trilha de quem mandou o quê e quando fica
preservada na própria pasta.

### Pasta ou formulário na internet?

São dois canais, e convivem. A pasta compartilhada serve quem você conhece e a quem
dá acesso: sócios, secretária, contador. O **formulário público**, descrito na seção
seguinte, serve quem não tem acesso a nada — fornecedor, prestador eventual, alguém
que mandou uma nota uma vez só.

A pasta não exige publicar nada e resolve o caso do dia a dia. O formulário exige uma
conta na Cloudflare, mas dispensa a outra pessoa de ter qualquer acesso seu.

---

## Formulário público — quem não tem acesso ao sistema

Para fornecedor, contador ou qualquer pessoa de fora: um endereço na internet onde
ela preenche quem é, do que se trata e o valor, anexa a nota e envia. Nenhuma conta,
nenhuma senha, nenhum aplicativo. Os envios aparecem na Caixa de Entrada do painel,
e você continua sendo o único que lança.

### O sigilo continua de pé

O conteúdo é cifrado **no aparelho de quem envia**, com uma chave pública embutida na
página. O servidor que recebe guarda bytes que ele mesmo não lê — nem a Cloudflare,
nem quem tiver acesso ao painel daquela conta. Só a chave privada, que vive em
`local/segredos.json`, abre um envio.

É o mesmo princípio do site de consulta, invertido: lá o conteúdo é cifrado aqui e
aberto por quem tem a senha; aqui é cifrado lá fora e aberto só por você.

### Publicar o recebedor

```powershell
node heli.mjs envio
```

Gera `envio/dist/worker.js` e imprime o passo a passo. Resumo do que é feito uma vez
só, na Cloudflare:

1. Conta em `dash.cloudflare.com` — o plano gratuito basta. **Escolhemos Cloudflare
   em vez de Vercel porque o plano gratuito da Vercel proíbe uso comercial**, e a
   operação é uma empresa.
2. Em R2, um bucket chamado `heli-envios`.
3. Em Workers & Pages, um Worker com o conteúdo de `envio/dist/worker.js`.
4. Nas configurações do Worker: binding de R2 `ENVIOS` → `heli-envios`, variável
   `SEGREDO_ADMIN` (senha longa e aleatória) e `CODIGO` (palavra curta que vai no link).
5. De volta aqui: `node heli.mjs envio-config` registra o endereço e imprime o link
   para divulgar.

O gratuito da Cloudflare cobre 100 mil requisições por dia e 10 GB no R2 — ordens de
grandeza acima do que uma operação deste porte consome.

### O código no link

O link divulgado tem a forma `.../?c=palavra`. Não é proteção criptográfica: serve
para que o endereço, se descoberto por acaso, não vire caixa de spam. Trocar o código
na Cloudflare invalida os links antigos.

### O que acontece quando um envio chega

Na Caixa de Entrada aparece o protocolo, o tamanho e a data — **o conteúdo só é
revelado quando você clica em Abrir**, porque é nesse momento que ele é baixado e
decifrado aqui na sua máquina. Abrindo, os arquivos vão para o formulário e passam
pela leitura automática de sempre.

Quando a nota responde um campo, o dado dela prevalece sobre o que a pessoa digitou —
o XML é autoridade, o texto livre não. Mas nada do que ela escreveu se perde: o que
não virou campo desce para a observação, junto com o nome e o contato de quem enviou.

Depois de lançado, o envio é apagado do recebedor. O comprovante fica anexado ao
lançamento, como qualquer outra nota.

### Se você perder a chave privada

Envios que ainda estiverem no recebedor tornam-se ilegíveis para sempre — não há
recuperação, por construção. `local/segredos.json` é a única cópia, e ele está no
OneDrive. Gerar um par novo não recupera envios antigos: exige republicar o Worker e
pedir reenvio.

---

## Leitura automática da nota

Nada aqui usa IA nem OCR. São três leituras determinísticas: ou o dado é lido com
exatidão, ou o campo fica vazio para você preencher. O sistema nunca aproxima.

### 1. O XML da nota — o caminho completo

Arraste o arquivo `.xml` na área de anexo. Preenche fornecedor, CNPJ, valor, data,
número, tipo, chave e descrição de uma vez. O arquivo fica anexado ao lançamento
como comprovante.

Funciona com NF-e e NFC-e (layout nacional da SEFAZ, imutável há anos) e com NFS-e
tanto no padrão nacional quanto no layout ABRASF que parte dos municípios ainda usa.
Desde 1º/01/2026 todos os municípios devem seguir o padrão nacional da NFS-e, então
a cobertura em nota de serviço só melhora daqui para frente.

**Peça o XML aos fornecedores.** Eles são obrigados a fornecer, e normalmente já
mandam junto com o PDF — é só não descartar o anexo.

### 2. A chave de acesso — 44 dígitos que já dizem muito

Cole no campo *Chave de acesso*. Os próprios dígitos carregam UF, ano e mês de
emissão, CNPJ do emitente, modelo, série e número:

```
43 1712 07364617000135 55 000 000012014 1 00012014 6
UF  AAMM  CNPJ emitente  ·  série  número  ·        DV
```

O último dígito é um verificador módulo 11. Se você errar ou trocar um número na
digitação, o painel avisa na hora — não deixa passar chave inválida.

### 3. O QR Code do DANFE — quando só veio o papel

Arraste a foto do DANFE. O painel decodifica o QR Code e extrai a chave, caindo no
caminho 2. Decodificar QR é geometria e correção de erro Reed-Solomon: ou o código
está legível, ou não sai nada — nunca sai "quase certo".

Com PDF, o painel procura a chave na camada de texto do arquivo. Se o PDF for uma
imagem escaneada, não há texto para achar: use a foto para ler o QR, ou cole a chave.

### O que a leitura nunca faz

**Não sobrescreve o que você digitou.** Só campos vazios são preenchidos, e o painel
lista quais foram. A única exceção são os valores que o próprio formulário sugeriu —
a data de hoje e o tipo "NF-e" — que cedem lugar ao dado real da nota.

**Não lê nota escaneada sem QR.** OCR clássico erra CNPJ e valor o suficiente para
você ter de conferir tudo, o que anularia o ganho. Preferimos não oferecer.

**Não consulta nada online.** O decodificador de QR está versionado em
`painel/vendor/` e roda offline. Nenhum dado seu sai da máquina.

---

## Rateio entre sócios

Cada despesa sai do bolso de uma pessoa, mas pertence a todos conforme as quotas.
O sistema fecha essa conta sozinho.

```powershell
node heli.mjs socios
```

Você informa nome e quota de cada sócio (ex.: Miguel 60%, Sócio 2 40%). A partir daí,
todo lançamento é dividido nessa proporção — sem você precisar fazer nada. No `add`,
a pergunta sobre rateio já vem com "pelas quotas" selecionada; é só apertar enter.

Quando um lançamento foge da regra, há duas saídas na mesma pergunta:

- **percentuais só para este lançamento** — ex.: um treinamento 70/30 porque um sócio
  levou dois pilotos e o outro um;
- **inteira para o pagador** — despesa que não se divide com ninguém.

### Como o acerto é calculado

Para cada sócio o sistema apura **o que ele desembolsou** e **o que cabia a ele**. A
diferença é o saldo: positivo, tem a receber; negativo, tem a pagar. Depois monta as
transferências que zeram todo mundo — no máximo uma a menos que o número de pessoas
envolvidas.

```powershell
node heli.mjs acerto
```

O mesmo quadro aparece no site, nos dois níveis de acesso.

**Três regras que valem a pena saber:**

**Só entra o que já saiu do bolso.** Lançamentos com status `a pagar` ficam de fora do
acerto — ninguém desembolsou nada ainda. Eles aparecem à parte, como compromisso
futuro. `pago` e `reembolsar` entram.

**Quem pagou sem ser sócio vira credor puro.** Se um investidor ou terceiro adiantou
dinheiro, ele entra na conta com quota zero: tem a receber o valor inteiro. Aparece
marcado como "não sócio".

**As contas fecham no centavo.** Todo o cálculo roda em centavos inteiros, com o
resto da divisão distribuído por maior fração. A soma das partes é sempre exatamente
o valor da despesa — nunca sobra nem falta um centavo no acerto.

### Mudar as quotas depois

Rode `node heli.mjs socios` de novo. As quotas novas valem para **todo o histórico**,
inclusive lançamentos antigos, porque o rateio é recalculado a cada build. Se a
mudança deve valer só daqui para frente, use percentuais específicos nos lançamentos
antigos antes de trocar o padrão.

---

### Todos os comandos

| Comando | O que faz |
|---|---|
| `node heli.mjs painel` | Abre o painel no navegador. O jeito fácil. |
| `node heli.mjs envio` | Gera o formulário público de envio de notas. |
| `node heli.mjs envio-config` | Registra o endereço do recebedor e imprime o link. |
| `node heli.mjs init` | Configuração inicial: define as duas senhas e cria o ledger. Roda uma vez só. |
| `node heli.mjs socios` | Define os sócios e suas quotas de rateio. |
| `node heli.mjs add` | Registra um lançamento (interativo). |
| `node heli.mjs list` | Lista os lançamentos no terminal. |
| `node heli.mjs acerto` | Mostra quem deve a quem, e quanto. |
| `node heli.mjs rm 2026-0004` | Remove um lançamento e seus anexos. |
| `node heli.mjs build` | Recifra `docs/data/` sem publicar. |
| `node heli.mjs publish` | Build + commit + push. |
| `node heli.mjs senha` | Troca a senha TOTAL ou a RESUMO. |
| `node heli.mjs restore` | Reconstrói `local/` a partir do que está publicado. |

### Corrigir um lançamento já feito

Pelo painel: botão **Editar** na linha. Em último caso, `local/ledger.json` é JSON
legível e pode ser editado à mão — depois rode `node heli.mjs publish`.

---

## O que você precisa saber sobre a segurança

**A senha é a única defesa.** Como o repositório é público, qualquer pessoa pode
baixar os arquivos cifrados e tentar quebrá-los offline, sem limite de tentativas.
As 600.000 iterações de PBKDF2 tornam isso caro, mas não impossível contra uma senha
fraca. Use frases longas — quatro ou cinco palavras sem sentido juntas valem mais
que oito caracteres com símbolos.

**Não há recuperação.** Perdeu a senha TOTAL, perdeu os dados. Guarde as duas em um
gerenciador de senhas.

**O que vaza mesmo sem a senha:** o nome da operação (em `meta.json`), a data de cada
publicação, quantos lançamentos têm nota anexada e o tamanho aproximado de cada
arquivo. Nenhum valor, nome ou documento.

**Trocar a senha não apaga o passado.** O histórico do git guarda as versões antigas,
cifradas com a senha antiga. Se uma senha vazar, quem a tiver pode ler os commits
anteriores àquela troca. Para apagar de vez seria preciso reescrever o histórico.

**Backup:** `local/` está no OneDrive, e o que está publicado pode ser reconstruído
com `node heli.mjs restore`. Duas cópias independentes.

---

## Requisitos

Node.js 18 ou superior (você tem a 24) e git configurado com acesso ao repositório.
Nenhuma dependência externa — o sistema não instala nada.
