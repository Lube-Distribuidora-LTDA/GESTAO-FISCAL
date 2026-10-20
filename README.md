# Gestão Fiscal — Lube Distribuidora

BI da área Fiscal. Primeiro módulo: **tributação e preço de venda por região**. Para cada produto, em que regiões
falta a **tributação de saída** e em que regiões falta o **preço de venda**:

> Código do produto | Descrição | Regiões sem tributação | Regiões sem preço de venda

Caminho, como todo BI da casa: **WinThor (Oracle) → ETL em Python (VM `SRV-IA`) → Supabase, projeto DATA WAREHOUSE,
schema `fiscal` → painel (Vercel)**.

## De onde vem cada coisa

| Rotina | Nome no WinThor | Tabela | O que dá |
|---|---|---|---|
| **201** | Precificar Produto | `PCTABPR` | uma linha por produto × região: **preço de venda** (`PVENDA`) e **tributação de saída** (`CODST`) |
| **203** | Cadastrar Produto | `PCPRODUT` | código, descrição, NCM, fornecedor, departamento, seção, fora de linha, revenda |
| **302** | Cadastrar Cliente | `PCCLIENT` (+ `PCPRACA`) | a região em que cada cliente compra (`NUMREGIAOCLI`, ou a da praça) |
| **514** | Cadastrar tipo de tributação | `PCTRIBUT` | o que cada CODST é: mensagem, CST, alíquota de ICMS, CFOP |
| **572** | (regiões) | `PCREGIAO` | nome, UF, filial, ativa/inativa |
| — | venda faturada | `PCMOV` | venda dos últimos 12 meses por produto × região (o que é mais urgente) |
| — | estoque | `PCEST` | estoque de hoje nas filiais 1, 7, 10, 11 e 12 |

**Por que não a `PCTABTRIB`:** é a *tributação por UF*, e ela está **desligada** no WinThor da Lube
(`PCPARAMFILIAL.CON_USATRIBUTACAOPORUF = 'N'`, `PCCONSUM.USATRIBUTACAOPORUF = 'N'`, conferido em 2026-10-20). Tem uma
linha por produto, só filial 1 × ES, quase toda com CODST 0. A tributação de saída que vale é o `CODST` da `PCTABPR`,
por região — a coluna "Tributação" da própria 201.

## A regra (uma só, no banco: `fiscal.vw_situacao`)

| Situação | Quando |
|---|---|
| **Completo** | tem tributação e preço de venda na região |
| **Sem tributação** | tem preço, e o CODST está vazio (ou aponta para um código que não existe na 514) |
| **Sem preço de venda** | tem tributação, e o `PVENDA` é zero ou vazio |
| **Sem tributação e sem preço** | a linha da 201 existe, mas vazia |
| **Fora da tabela da região** | o produto não tem linha na `PCTABPR` para a região |

"Região sem tributação" de um produto = sem tributação + sem os dois + fora da tabela. "Região sem preço de venda" =
sem preço + sem os dois + fora da tabela.

## Universo (decisões)

- **Regiões:** só as 16 que o Júlio pediu em 2026-10-20 — 18, 19, 23, 27, 31, 33, 35, 37, 38, 39, 40, 41, 42, 43, 45 e
  46. Ficam no `ENV` (`FISCAL_REGIOES`) e no banco (`fiscal.regiao.no_painel`). **A região 1 (Espírito Santo) não está
  na lista.**
- **Produtos: só os ATIVOS** (pedido do Júlio em 2026-10-20: "apenas produtos ATIVOS e não todos, como: CONSUMO, INATIVOS
  e etc.") — 5.318 em 2026-10-20. Ativo = não excluído, de revenda (`REVENDA <> 'N'`), **em linha** (`OBS2 <> 'FL'`, o "ATIVO"
  dos outros BIs da casa), **fora do fornecedor "INATIVOS"** (cód. 658801) e **sem ser item de consumo** (descrição com
  "CONSUMO" ou departamento 9 Material Consumo; e tipo de mercadoria preenchido). O `TIPOMERC = 'MC'` não serve de critério:
  Guaraná Antarctica, Sukita e Água Tônica estão como MC e são de revenda, com venda. Regra e números em
  `etl/consultas_fiscal.py` (`UNIVERSO`).
- **Venda:** `CODOPER = 'S'` não cancelada dos últimos 12 meses, `QT × (PUNIT + VLOUTROS)`, todas as filiais (o que
  importa é a região de preço da venda).

## Estrutura

```
etl/        carga (Python)
  bi_comum.py            infraestrutura comum (mesma dos outros BIs)
  consultas_fiscal.py    catálogo: 5 consultas, uma por tabela de destino
  sync_fiscal.py         orquestrador: consultas → conferência × PCTABPR → pacote do painel
  diagnostico_fiscal.py  roda tudo SEM GRAVAR e confere contra a contagem do WinThor
  executar.py · instalar_e_agendar.ps1 · INSTALAR TUDO.bat · ATUALIZAR AGORA.bat · DIAGNOSTICO.bat · LEIA-ME.txt · ENV.example
web/        painel
  index.html, css/, js/  telas (o navegador filtra e soma tudo)
  api/dados.js           entrega o pacote comprimido guardado no banco
  api/versao.js          diz qual pacote está no banco (o navegador só baixa se mudou)
  api/img.js             foto do produto (miniatura que o Gestão Comercial guarda)
  db/                    migrações do schema `fiscal` (01 a 03; 01 e 02 são a definição vigente)
  servidor_local.js      abre o painel no computador, contra o banco de verdade
  middleware.ts + sentinela-guarda.ts   guarda da Sentinela (só entra quem tem acesso pelo Painel Lube)
INICIAR.bat  abre o painel nesta máquina (http://localhost:3103)
```

## O banco (schema `fiscal`, DATA WAREHOUSE)

| Tabela | Conteúdo | Carga |
|---|---|---|
| `fato_preco_regiao` | a `PCTABPR` do universo (produto × região): CODST, preço de venda, preço de tabela, data e rotina da última alteração | TRUNCATE + INSERT |
| `fato_venda_regiao` | venda faturada por produto × região (linhas, quantidade, valor, última venda) | TRUNCATE + INSERT |
| `produto` | cadastro dos produtos ativos, com NCM e estoque de hoje | TRUNCATE + INSERT |
| `regiao` | as 50 regiões do WinThor, com clientes por região e a marca `no_painel` | upsert |
| `tributacao` | a `PCTRIBUT` inteira (798 códigos) | upsert |
| `controle_carga` | um registro por passo de cada carga | — |
| `painel_cache` | o pacote do painel, comprimido (gzip, ~0,5 MB) | refeito em toda carga |

Toda tabela com **RLS ligado e sem políticas**. `vw_situacao` é a regra; `painel_dados(meses)` monta o pacote (lê
`trade.produto_miniatura` só para saber quais produtos têm foto). O `core.dim_produto` (dono: BI COMPRAS) não tem NCM,
departamento, seção nem REVENDA: por isso o `fiscal.produto` próprio (exceção consciente, como no Inventário).

## Validação

- **A carga confere a si mesma:** depois de gravar, o passo `conferencia` conta, região a região, linhas, sem tributação
  e sem preço no banco e na `PCTABPR` — **na mesma transação de leitura do Oracle** (`SET TRANSACTION READ ONLY`), para
  um preço mudado na 201 durante a carga não virar alarme falso. 2026-10-20: igual nas 50 regiões (644.433 linhas) e,
  depois do recorte, nas 16 (116.432 linhas).
- **Tela × banco, só ativos (2026-10-20, carga das 13:16):** 5.318 produtos, 4.811 com região sem tributação, 5.188 com região
  sem preço, 1.603 com preço e sem tributação, 63.499 de 85.088 combinações completas — iguais à `fiscal.vw_situacao`; conferência
  da carga igual à `PCTABPR` nas 16 regiões (85.088 linhas).
- **Tela × banco, antes do recorte de ativos:** 7.277 produtos, 6.686 com região sem tributação, 7.133 com região sem preço, 83.544 de 116.432
  combinações completas — iguais à consulta em `fiscal.vw_situacao`.
- **Tela × WinThor, produto a produto:** cód. 15722 (Coca-Cola Zero lata) nas 16 regiões: CODST e preço iguais à
  `PCTABPR`.

## O painel

Telas: **Visão geral** (cartões, situação por região, departamentos e fornecedores com pendência, os mais urgentes) ·
**Produtos** (a lista pedida: código, descrição, regiões sem tributação, regiões sem preço — cada região é um chip
colorido que abre a região) · **Mapa produto × região** (a matriz colorida, com a tributação e o preço na dica) ·
**Regiões** (pendências, clientes e venda de cada uma).

No padrão da casa: filtros de múltipla escolha com busca (vazio = todos), **todo clique abre o relatório do recorte**
(produto: região a região com CODST, CST, ICMS, CFOP e preço; região: produtos com pendência; Voltar; Ctrl+clique
filtra), foto do produto, Excel formatado com os filtros escritos, link da visão, tema claro/escuro, modo apresentação.

## Rodar

```
cd etl
python diagnostico_fiscal.py     # sem gravar
python sync_fiscal.py            # carga completa
python sync_fiscal.py --so-pacote
cd ..\web
npm install
node servidor_local.js           # http://localhost:3103
```

Agendamento (na VM `SRV-IA`): `P:\INTEGRAÇÃO BI\FISCAL\INSTALAR TUDO.bat` — tarefa `Fiscal - Sync` às 07:15, 10:15,
13:15, 16:15 e 19:15. "A carga entrou?" se responde em `fiscal.controle_carga`, nunca pelo log da tela.

## Vercel

Projeto `gestao-fiscal` (`prj_YF4fRNaCEaKmEmjbVTN5ZIpUTjMl`), **https://gestao-fiscal.vercel.app**, ligado a este
repositório (push na `main` publica sozinho). Root Directory `web`, Framework Other, sem build, região `gru1`, Node 22.x,
Vercel Authentication Standard. Variáveis (cadastradas pelo Júlio, Production, Sensitive, porta **5432**):
`SUPABASE_DB_HOST`, `SUPABASE_DB_PORT`, `SUPABASE_DB_NAME`, `SUPABASE_DB_USER`, `SUPABASE_DB_PASSWORD`. Guarda da
Sentinela com `exige_login`, registrado no banco do portal **antes** do primeiro deploy (2026-10-20); o cartão do portal
("GESTÃO FISCAL", categoria CONTABILIDADE) nasceu inativo.

## Acesso

Preço e tributação são dado interno: **só abre para quem tem acesso pelo Painel Lube** (guarda da Sentinela). Senha,
IP interno e dado de pessoa nunca entram neste repositório.
