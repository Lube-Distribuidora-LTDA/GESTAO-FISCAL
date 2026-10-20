#!/usr/bin/env python3
"""
consultas_fiscal.py — catalogo de consultas do sistema GESTAO FISCAL.

Primeiro modulo: TRIBUTACAO E PRECO POR REGIAO. Para cada produto, em que regioes
falta a tributacao de saida e em que regioes falta o preco de venda.

De onde vem cada coisa no WinThor:

    201  Precificar Produto     -> PCTABPR: uma linha por produto x regiao, com o
                                   PRECO DE VENDA (PVENDA) e a TRIBUTACAO de saida
                                   da regiao (CODST, que aponta para a PCTRIBUT).
                                   E a mesma grade que a 201 mostra.
    203  Cadastrar Produto      -> PCPRODUT: codigo, descricao, NCM, fornecedor,
                                   departamento, secao, fora de linha, revenda.
    302  Cadastrar Cliente      -> PCCLIENT: a regiao em que cada cliente compra
                                   (NUMREGIAOCLI, ou a regiao da praca, PCPRACA).
                                   Serve para dizer quais regioes tem cliente.
    514  Tipos de tributacao    -> PCTRIBUT: o que cada CODST significa (mensagem,
                                   CST, aliquota de ICMS, CFOP).
    572  Regioes                -> PCREGIAO: nome, UF, filial, ativa/inativa.

    Mais o PCMOV (venda faturada dos ultimos meses, por produto x regiao) para dizer
    quais regioes estao EM USO e se o produto vendeu naquela regiao, e o PCEST
    (estoque de hoje) para separar produto parado de produto que gira.

POR QUE NAO A PCTABTRIB: e a "tributacao por UF", que no WinThor da Lube esta
DESLIGADA (PCPARAMFILIAL.CON_USATRIBUTACAOPORUF = 'N' e PCCONSUM.USATRIBUTACAOPORUF =
'N', conferido em 2026-10-20). Ela so tem uma linha por produto, filial 1 x ES, quase
toda com CODST 0. Quem manda na tributacao de saida e o CODST da PCTABPR, por regiao.

Consultas, uma por tabela de destino, todas no schema `fiscal`:

    tributacao    -> fiscal.tributacao         (PCTRIBUT)
    regiao        -> fiscal.regiao             (PCREGIAO + clientes por regiao)
    produto       -> fiscal.produto            (PCPRODUT + estoque de hoje)
    venda_regiao  -> fiscal.fato_venda_regiao  (venda faturada por produto x regiao)
    preco_regiao  -> fiscal.fato_preco_regiao  (PCTABPR dos produtos nao excluidos)

A SITUACAO de cada produto x regiao (completo, sem tributacao, sem preco, sem os
dois) NAO e calculada aqui: ela mora no banco (fiscal.vw_situacao e
fiscal.painel_dados()). Mudar a regra nao exige carga.

Recortes (no ENV):
    FISCAL_REGIOES=18,19,23,...           as regioes que o painel mostra (padrao: as 16 que o Julio
                                          escolheu em 2026-10-20; a regiao 1 ficou de fora no pedido)
    FISCAL_MESES_VENDA=12                 janela da venda por produto x regiao
    FISCAL_FILIAIS_ESTOQUE=1,11,12        filiais onde o produto precisa ter estoque para entrar, e que
                                          somam o estoque mostrado (pedido do Julio em 2026-10-20)

Universo: produtos ATIVOS (nao excluidos, de revenda, em linha, fora do fornecedor
"INATIVOS" e sem ser item de consumo; criterios e numeros em UNIVERSO, abaixo) x as
regioes escolhidas. Produto, preco e venda vem so do universo (fiscal.produto e TRUNCATE +
INSERT: produto que sai do universo sai da tabela junto); regiao e tributacao vem
inteiras (sao pequenas; a regiao leva a marca no_painel).
"""

from __future__ import annotations

import os
from datetime import date
from typing import Any

from bi_comum import Consulta, inteiro, texto

# Pedido do Julio em 2026-10-20: "preciso apenas dos produtos que tem estoque nas filiais 1, 11 e 12".
FILIAIS_PADRAO = "1,11,12"
# Pedido do Julio em 2026-10-20: "eu preciso de apenas algumas regioes".
REGIOES_PADRAO = "18,19,23,27,31,33,35,37,38,39,40,41,42,43,45,46"


def regioes_painel() -> list[int]:
    bruto = (os.environ.get("FISCAL_REGIOES") or REGIOES_PADRAO).strip() or REGIOES_PADRAO
    return sorted({int(x) for x in bruto.split(",") if x.strip()})


def _in_regiao(coluna: str) -> str:
    # NUMREGIAO e numero no WinThor; os valores vem de int(), sem texto livre no SQL.
    return f"{coluna} IN ({', '.join(str(r) for r in regioes_painel())})"


def meses_venda() -> int:
    bruto = (os.environ.get("FISCAL_MESES_VENDA") or "12").strip() or "12"
    return max(1, min(36, int(bruto)))


def filiais_estoque() -> list[int]:
    bruto = (os.environ.get("FISCAL_FILIAIS_ESTOQUE") or FILIAIS_PADRAO).strip() or FILIAIS_PADRAO
    return [int(x) for x in bruto.split(",") if x.strip()]


def _in_filial(coluna: str) -> str:
    # CODFILIAL e texto no WinThor ('1', '10'): compara com texto. Os valores vem de
    # int(), entao nao ha texto livre indo para o SQL.
    return f"{coluna} IN ({', '.join(repr(str(f)) for f in filiais_estoque())})"


def _num(v: Any) -> float | None:
    return None if v is None else float(v)


def _data(v: Any) -> date | None:
    if v is None:
        return None
    return v.date() if hasattr(v, "date") else v


# ---------------------------------------------------------------------------
# 514 — tipos de tributacao (PCTRIBUT)
# ---------------------------------------------------------------------------
SQL_TRIBUTACAO = """
SELECT T.CODST, T.MENSAGEM, T.OBS, T.SITTRIBUT, T.CODICM, T.CODICMTAB, T.IVA,
       T.PERCBASERED, T.CODFISCAL, T.CODFISCALINTER
  FROM PCTRIBUT T
"""
COLUNAS_TRIBUTACAO = ("codst", "mensagem", "obs", "sittribut", "aliq_icms", "aliq_icms_tab", "iva",
                      "perc_base_red", "cfop", "cfop_inter")


def _mapear_tributacao(r: dict[str, Any]) -> tuple:
    return (inteiro(r["codst"]), texto(r["mensagem"]), texto(r["obs"]), texto(r["sittribut"]),
            _num(r["codicm"]), _num(r["codicmtab"]), _num(r["iva"]), _num(r["percbasered"]),
            inteiro(r["codfiscal"]), inteiro(r["codfiscalinter"]))


# ---------------------------------------------------------------------------
# 572 + 302 — regioes e quantos clientes compram em cada uma
# ---------------------------------------------------------------------------
# A regiao em que o cliente compra e a dele (NUMREGIAOCLI) ou, sem ela, a da praca.
# Cliente ativo = nao excluido e nao bloqueado. "Comprou" = DTULTCOMP dentro da janela.
SQL_REGIAO = """
SELECT R.NUMREGIAO, R.REGIAO, R.UF, R.CODFILIAL, R.STATUS,
       NVL(C.CLIENTES, 0)        AS CLIENTES,
       NVL(C.CLIENTES_ATIVOS, 0) AS CLIENTES_ATIVOS,
       NVL(C.COMPRARAM, 0)       AS COMPRARAM
  FROM PCREGIAO R
  LEFT JOIN (
        SELECT NVL(CL.NUMREGIAOCLI, PR.NUMREGIAO) AS NUMREGIAO,
               COUNT(*) AS CLIENTES,
               SUM(CASE WHEN CL.DTEXCLUSAO IS NULL AND NVL(CL.BLOQUEIO, 'N') <> 'S' THEN 1 ELSE 0 END) AS CLIENTES_ATIVOS,
               SUM(CASE WHEN CL.DTEXCLUSAO IS NULL AND CL.DTULTCOMP >= ADD_MONTHS(TRUNC(SYSDATE), -:meses) THEN 1 ELSE 0 END) AS COMPRARAM
          FROM PCCLIENT CL
          LEFT JOIN PCPRACA PR ON PR.CODPRACA = CL.CODPRACA
         GROUP BY NVL(CL.NUMREGIAOCLI, PR.NUMREGIAO)
       ) C ON C.NUMREGIAO = R.NUMREGIAO
"""
COLUNAS_REGIAO = ("numregiao", "regiao", "uf", "codfilial", "status", "ativa", "clientes", "clientes_ativos",
                  "clientes_compraram", "no_painel")


def _mapear_regiao(r: dict[str, Any]) -> tuple:
    status = texto(r["status"])
    return (inteiro(r["numregiao"]), texto(r["regiao"]), texto(r["uf"]), texto(r["codfilial"]), status,
            (status or "A").upper() != "I", inteiro(r["clientes"]) or 0, inteiro(r["clientes_ativos"]) or 0,
            inteiro(r["compraram"]) or 0, inteiro(r["numregiao"]) in regioes_painel())


# ---------------------------------------------------------------------------
# 203 — produto (com o estoque de hoje nas filiais de distribuicao)
# ---------------------------------------------------------------------------
SQL_PRODUTO = """
SELECT P.CODPROD, P.DESCRICAO, P.EMBALAGEM, P.UNIDADE, P.NBM,
       P.CODFORNEC, F.FORNECEDOR, P.CODEPTO, D.DESCRICAO AS DEPARTAMENTO,
       P.CODSEC, S.DESCRICAO AS SECAO, P.OBS2, P.REVENDA, P.DTEXCLUSAO, P.DTCADASTRO,
       NVL(E.ESTOQUE, 0) AS ESTOQUE
  FROM PCPRODUT P
  LEFT JOIN PCFORNEC F ON F.CODFORNEC = P.CODFORNEC
  LEFT JOIN PCDEPTO D  ON D.CODEPTO = P.CODEPTO
  LEFT JOIN PCSECAO S  ON S.CODSEC = P.CODSEC
  LEFT JOIN (SELECT CODPROD, SUM(QTESTGER) AS ESTOQUE FROM PCEST WHERE {filial} GROUP BY CODPROD) E
         ON E.CODPROD = P.CODPROD
 WHERE {universo}
"""
COLUNAS_PRODUTO = ("codprod", "descricao", "embalagem", "unidade", "ncm", "codfornec", "fornecedor",
                   "codepto", "departamento", "codsec", "secao", "fora_de_linha", "revenda", "excluido",
                   "dtcadastro", "estoque")


def _mapear_produto(r: dict[str, Any]) -> tuple:
    return (
        inteiro(r["codprod"]), texto(r["descricao"]), texto(r["embalagem"]), texto(r["unidade"]), texto(r["nbm"]),
        inteiro(r["codfornec"]), texto(r["fornecedor"]), inteiro(r["codepto"]), texto(r["departamento"]),
        inteiro(r["codsec"]), texto(r["secao"]),
        (r["obs2"] or "").strip().upper() == "FL",
        (r["revenda"] or "S").strip().upper() != "N",          # REVENDA nulo conta como de revenda (padrao do WinThor)
        r["dtexclusao"] is not None,
        _data(r["dtcadastro"]), _num(r["estoque"]) or 0.0,
    )


# ---------------------------------------------------------------------------
# PCMOV — venda faturada por produto x regiao (diz se a regiao esta em uso)
# ---------------------------------------------------------------------------
# Venda = CODOPER 'S' nao cancelada, valor QT x (PUNIT + VLOUTROS), como no Gestao
# Comercial. Todas as filiais: o que interessa aqui e a REGIAO de preco da venda.
SQL_VENDA = """
SELECT M.CODPROD, M.NUMREGIAO,
       COUNT(*)                                        AS LINHAS,
       SUM(M.QT)                                       AS QT,
       SUM(M.QT * (NVL(M.PUNIT, 0) + NVL(M.VLOUTROS, 0))) AS VALOR,
       MAX(M.DTMOV)                                    AS ULTIMA
  FROM PCMOV M
  JOIN PCPRODUT P ON P.CODPROD = M.CODPROD
 WHERE M.CODOPER = 'S'
   AND M.DTCANCEL IS NULL
   AND M.DTMOV >= ADD_MONTHS(TRUNC(SYSDATE), -:meses)
   AND {regiao}
   AND {universo}
 GROUP BY M.CODPROD, M.NUMREGIAO
"""
COLUNAS_VENDA = ("codprod", "numregiao", "linhas", "qt", "valor", "ultima_venda")


def _mapear_venda(r: dict[str, Any]) -> tuple:
    return (inteiro(r["codprod"]), inteiro(r["numregiao"]), inteiro(r["linhas"]) or 0, _num(r["qt"]) or 0.0,
            _num(r["valor"]) or 0.0, _data(r["ultima"]))


# ---------------------------------------------------------------------------
# 201 — preco e tributacao por regiao (PCTABPR)
# ---------------------------------------------------------------------------
# So o universo (produto de revenda nao excluido x regiao escolhida). A linha vem como esta: a regra
# de "sem tributacao" (CODST nulo ou inexistente na PCTRIBUT) e "sem preco" (PVENDA
# nulo ou zero) mora no banco.
SQL_PRECO = """
SELECT T.CODPROD, T.NUMREGIAO, T.CODST, T.PVENDA, T.PTABELA, T.DTULTALTPVENDA, T.ROTINA
  FROM PCTABPR T
  JOIN PCPRODUT P ON P.CODPROD = T.CODPROD
 WHERE {universo}
   AND {regiao}
"""
COLUNAS_PRECO = ("codprod", "numregiao", "codst", "pvenda", "ptabela", "dt_alt_preco", "rotina")


def _mapear_preco(r: dict[str, Any]) -> tuple:
    return (inteiro(r["codprod"]), inteiro(r["numregiao"]), inteiro(r["codst"]), _num(r["pvenda"]),
            _num(r["ptabela"]), r["dtultaltpvenda"], texto(r["rotina"]))


# ---------------------------------------------------------------------------
# Catalogo
# ---------------------------------------------------------------------------
# So produto ATIVO (pedido do Julio em 2026-10-20: "apenas produtos ATIVOS e nao todos, como:
# CONSUMO, INATIVOS e etc."). Cada criterio, e o que ele tirou em 2026-10-20 (dos 7.277 de revenda):
#   1. nao excluido (DTEXCLUSAO vazia)
#   2. de revenda (REVENDA <> 'N'; nulo conta como revenda, padrao do WinThor)
#   3. em linha: OBS2 <> 'FL' -- e o "ATIVO" dos outros BIs da casa (COMPRAS, COMERCIAL, TRADE); tirou 1.864
#   4. fora do fornecedor "INATIVOS" (cod. 658801), onde a Lube guarda o que saiu de linha; tirou mais 26
#   5. nao e consumo: descricao sem "CONSUMO" ("... (CONSUMO)", "(LUBE-CONSUMO)") e fora do departamento
#      9 MATERIAL CONSUMO; tirou 66 itens, nenhum com venda em 12 meses
#   6. com tipo de mercadoria preenchido (TIPOMERC): tirou 3 sem tipo (copiadora, cadeiras, tecido), sem venda
#      nem estoque
#   7. com ESTOQUE (QTESTGER > 0) em pelo menos uma das filiais de FISCAL_FILIAIS_ESTOQUE (padrao 1, 11 e 12;
#      pedido do Julio em 2026-10-20). Dos 5.328 ativos, 4.272 tem; "nas tres ao mesmo tempo" seriam so 10.
# O TIPOMERC = 'MC' (material de consumo) NAO serve de criterio: o Guarana Antarctica, a Sukita e a Agua
# Tonica estao cadastrados como MC e sao de revenda, com venda -- filtrar por ele esconderia produto vendido.
FORNEC_INATIVOS = int((os.environ.get("FISCAL_FORNEC_INATIVOS") or "658801").strip() or "658801")
DEPTO_CONSUMO = int((os.environ.get("FISCAL_DEPTO_CONSUMO") or "9").strip() or "9")
UNIVERSO = (
    "P.DTEXCLUSAO IS NULL AND NVL(P.REVENDA, 'S') <> 'N' AND NVL(P.OBS2, ' ') <> 'FL'"
    f" AND NVL(P.CODFORNEC, 0) <> {FORNEC_INATIVOS} AND NVL(P.CODEPTO, 0) <> {DEPTO_CONSUMO}"
    " AND UPPER(P.DESCRICAO) NOT LIKE '%CONSUMO%' AND P.TIPOMERC IS NOT NULL"
    " AND EXISTS (SELECT 1 FROM PCEST E WHERE E.CODPROD = P.CODPROD AND E.QTESTGER > 0 AND " + _in_filial("E.CODFILIAL") + ")"
)


def _montar() -> list[Consulta]:
    meses = meses_venda()
    return [
        Consulta(nome="tributacao", descricao="Tipos de tributacao de saida (PCTRIBUT, rotina 514)", pagina="FISCAL",
                 sql=SQL_TRIBUTACAO, destino="fiscal.tributacao", colunas=COLUNAS_TRIBUTACAO,
                 mapear=_mapear_tributacao, chave_conflito=("codst",)),
        Consulta(nome="regiao", descricao="Regioes (PCREGIAO) e clientes que compram em cada uma (PCCLIENT)",
                 pagina="FISCAL", sql=SQL_REGIAO, destino="fiscal.regiao", colunas=COLUNAS_REGIAO,
                 mapear=_mapear_regiao, binds={"meses": meses}, chave_conflito=("numregiao",)),
        Consulta(nome="produto", descricao="Cadastro de produto (PCPRODUT, rotina 203) e estoque de hoje (PCEST)",
                 pagina="FISCAL", sql=SQL_PRODUTO.format(filial=_in_filial("CODFILIAL"), universo=UNIVERSO),
                 destino="fiscal.produto", colunas=COLUNAS_PRODUTO, mapear=_mapear_produto),
        Consulta(nome="venda_regiao", descricao=f"Venda faturada dos ultimos {meses} meses por produto x regiao (PCMOV)",
                 pagina="FISCAL", sql=SQL_VENDA.format(regiao=_in_regiao("M.NUMREGIAO"), universo=UNIVERSO), destino="fiscal.fato_venda_regiao", colunas=COLUNAS_VENDA,
                 mapear=_mapear_venda, binds={"meses": meses}, tolerancia_pct=0.15),
        Consulta(nome="preco_regiao", descricao="Preco de venda e tributacao por regiao (PCTABPR, rotina 201)",
                 pagina="FISCAL", sql=SQL_PRECO.format(regiao=_in_regiao("T.NUMREGIAO"), universo=UNIVERSO), destino="fiscal.fato_preco_regiao", colunas=COLUNAS_PRECO,
                 mapear=_mapear_preco, streaming=True),
    ]


def catalogo() -> list[Consulta]:
    """Monta o catalogo na hora (o ENV ja foi carregado pelo orquestrador)."""
    return _montar()


def selecionar(nomes: list[str] | None = None) -> list[Consulta]:
    todas = catalogo()
    if not nomes:
        ordem = ["tributacao", "regiao", "produto", "venda_regiao", "preco_regiao"]
        return sorted(todas, key=lambda c: ordem.index(c.nome))
    indice = {c.nome: c for c in todas}
    faltando = [n for n in nomes if n not in indice]
    if faltando:
        raise SystemExit(f"Consulta(s) inexistente(s): {', '.join(faltando)}. Use --listar.")
    return [indice[n] for n in nomes]


# ---------------------------------------------------------------------------
# Conferencia: o banco contra o WinThor, regiao a regiao
# ---------------------------------------------------------------------------
# Roda na MESMA transacao de leitura do Oracle que extraiu a PCTABPR (o sync abre
# um SET TRANSACTION READ ONLY): as duas leituras veem a mesma foto do banco, entao
# um preco mudado na 201 durante a carga nao vira alarme falso.
SQL_CONFERENCIA = """
SELECT T.NUMREGIAO,
       COUNT(*) AS LINHAS,
       SUM(CASE WHEN T.CODST IS NULL OR NOT EXISTS (SELECT 1 FROM PCTRIBUT X WHERE X.CODST = T.CODST) THEN 1 ELSE 0 END) AS SEM_TRIB,
       SUM(CASE WHEN NVL(T.PVENDA, 0) <= 0 THEN 1 ELSE 0 END) AS SEM_PRECO
  FROM PCTABPR T
  JOIN PCPRODUT P ON P.CODPROD = T.CODPROD
 WHERE {universo}
   AND {regiao}
 GROUP BY T.NUMREGIAO
"""


def sql_conferencia() -> str:
    return SQL_CONFERENCIA.format(universo=UNIVERSO, regiao=_in_regiao("T.NUMREGIAO"))
