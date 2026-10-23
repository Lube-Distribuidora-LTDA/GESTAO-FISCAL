#!/usr/bin/env python3
"""
diagnostico_fiscal.py — roda TODAS as consultas do GESTAO FISCAL contra o WinThor
SEM GRAVAR NADA, mede o tempo e confere o que da para conferir:

  1. quantas linhas cada consulta traz (e se o mapeamento roda sem erro);
  2. a PCTABPR extraida contra a contagem do proprio WinThor, regiao a regiao
     (linhas, sem tributacao, sem preco), na mesma transacao de leitura;
  3. a situacao de hoje por regiao, nos produtos de revenda nao excluidos —
     o mesmo numero que a tela vai mostrar;
  4. CODST da PCTABPR que nao existe na PCTRIBUT (se aparecer, a linha conta como
     "sem tributacao" e o diagnostico avisa).

Uso:  python diagnostico_fiscal.py
Resultado na tela e em diagnostico_fiscal.log.
"""

from __future__ import annotations

import sys
from collections import defaultdict

import bi_comum as bi

log = bi.configurar_log("diagnostico_fiscal.log")


def _f(n) -> str:
    return f"{n:,.0f}".replace(",", ".")


def main() -> int:
    bi.carregar_env()
    from consultas_fiscal import catalogo, filiais_estoque, meses_venda, regioes_painel, sql_conferencia

    cfg_ora = bi.OracleConfig.from_env()
    from consultas_fiscal import regioes_do_banco
    regioes_do_banco(bi.SupabaseConfig.from_env(), log)     # a mesma lista de regioes que a carga usa
    log.info("Regioes do painel: %s · venda dos ultimos %s meses · estoque das filiais %s", regioes_painel(), meses_venda(), filiais_estoque())
    problemas = 0
    with bi.conectar_oracle(cfg_ora) as conn:
        with conn.cursor() as cur:
            cur.execute("SET TRANSACTION READ ONLY")
        dados = {}
        for c in catalogo():
            rel = bi.cronometro()
            if c.streaming:
                linhas = []
                for lote in bi._lotes(conn, c, 50000):
                    for r in lote:
                        linhas.append(c.mapear(r))
            else:
                linhas = [c.mapear(r) for r in bi.extrair(conn, c)]
            dados[c.nome] = linhas
            log.info("%-14s %10s linhas  %6.1fs", c.nome, _f(len(linhas)), rel())

        # ---- 2. extraido x contagem do WinThor
        with conn.cursor() as cur:
            cur.execute(sql_conferencia())
            ora = {int(r[0]): (int(r[1]), int(r[2]), int(r[3])) for r in cur.fetchall()}
        conn.rollback()

    tribs = {t[0] for t in dados["tributacao"]}
    meu = defaultdict(lambda: [0, 0, 0])
    inexistentes = defaultdict(int)
    for (codprod, reg, codst, pvenda, *_resto) in dados["preco_regiao"]:
        x = meu[reg]
        x[0] += 1
        if codst is None or codst not in tribs:
            x[1] += 1
            if codst is not None:
                inexistentes[codst] += 1
        if not pvenda or pvenda <= 0:
            x[2] += 1
    dif = [r for r in sorted(set(ora) | set(meu)) if tuple(meu.get(r, (0, 0, 0))) != ora.get(r, (0, 0, 0))]
    if dif:
        problemas += 1
        log.warning("PCTABPR extraida DIFERENTE da contagem do WinThor em %d regiao(oes): %s", len(dif), dif[:10])
    else:
        log.info("PCTABPR extraida igual a contagem do WinThor nas %d regioes (linhas, sem tributacao, sem preco).", len(ora))
    if inexistentes:
        log.warning("CODST na PCTABPR que nao existe na PCTRIBUT (contam como sem tributacao): %s",
                    dict(sorted(inexistentes.items())[:20]))

    # ---- 3. situacao por regiao (produtos de revenda nao excluidos)
    prods = {p[0] for p in dados["produto"] if p[12] and not p[13]}       # revenda e nao excluido
    regioes = {r[0]: r for r in dados["regiao"]}
    venda = defaultdict(int)
    for (codprod, reg, linhas_v, *_r) in dados["venda_regiao"]:
        venda[reg] += linhas_v
    cel = {}
    for (codprod, reg, codst, pvenda, *_resto) in dados["preco_regiao"]:
        if codprod in prods:
            tem_t = codst is not None and codst in tribs
            tem_p = bool(pvenda and pvenda > 0)
            cel[(codprod, reg)] = 0 if tem_t and tem_p else 1 if tem_p else 2 if tem_t else 3
    log.info("")
    log.info("SITUACAO DE HOJE · %s produtos ativos", _f(len(prods)))
    log.info("%-6s %-38s %-6s %9s %9s %9s %9s %9s %10s", "REG", "NOME", "ATIVA", "COMPLETO", "SEM TRIB", "SEM PRECO",
             "OS DOIS", "FORA TAB", "VENDA 12M")
    for num in regioes_painel():
        cont = [0, 0, 0, 0, 0]
        for p in prods:
            cont[cel.get((p, num), 4)] += 1
        r = regioes[num]
        log.info("%-6s %-38s %-6s %9s %9s %9s %9s %9s %10s", num, (r[1] or "")[:38], "sim" if r[5] else "nao",
                 _f(cont[0]), _f(cont[1]), _f(cont[2]), _f(cont[3]), _f(cont[4]), _f(venda.get(num, 0)))
    log.info("")
    log.info("Diagnostico concluido %s.", "SEM problemas" if not problemas else f"com {problemas} ponto(s) para olhar")
    return 0 if not problemas else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        log.exception("Diagnostico falhou.")
        sys.exit(1)
