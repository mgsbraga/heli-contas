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

---

## Uso no dia a dia

Abra o PowerShell nesta pasta (ou dê dois cliques em `contas.bat`).

```powershell
node heli.mjs add
```

O comando pergunta data, descrição, categoria, fornecedor, CNPJ, tipo e número do
documento, valor, quem pagou, forma de pagamento, status e como dividir entre os
sócios (basta enter para usar as quotas). No fim pede o caminho do
PDF ou foto da nota — pode arrastar o arquivo para dentro da janela do terminal, que
o caminho é preenchido sozinho. Depois oferece publicar; aceitando, ele cifra,
commita e envia. O site atualiza em cerca de um minuto.

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

Edite `local/ledger.json` direto (é JSON legível) e rode `node heli.mjs publish`.

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
