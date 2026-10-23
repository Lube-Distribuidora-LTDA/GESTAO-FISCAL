#!/usr/bin/env python3
"""
sync_fiscal.py — orquestrador do sistema GESTAO FISCAL.

Leva para o Supabase (projeto DATA WAREHOUSE, schema `fiscal`) o preco de venda e
a tributacao de saida de cada produto em cada regiao (rotina 201, PCTABPR), com os
cadastros que dao sentido a eles, confere o resultado contra o WinThor e deixa
pronto o pacote do painel.

Passos:
  1. cada consulta do catalogo (tributacao, regiao, produto, venda por regiao,
     preco por regiao), cada uma isolada: se uma falhar, as outras seguem;
  2. conferencia: regiao a regiao, quantas linhas, quantas sem tributacao e
     quantas sem preco no banco contra a PCTABPR. Diferenca vira AVISO;
  3. pacote do painel: monta o JSON (fiscal.painel_dados()), comprime em gzip e
     guarda em fiscal.painel_cache — a API so le essa linha.

Toda a leitura do Oracle acontece numa transacao SO DE LEITURA (SET TRANSACTION
READ ONLY): extracao e conferencia veem a mesma foto do WinThor. Sem isso, um
preco cadastrado na 201 no meio da carga (a 201 e usada o dia inteiro) faria a
conferencia acusar uma diferenca que nao existe.

O resultado de cada passo fica em fiscal.controle_carga: e essa tabela, nao o
log na tela, que responde "a carga entrou?".

Como usar
---------
    python sync_fiscal.py                          # tudo
    python sync_fiscal.py --consulta preco_regiao  # so uma consulta (o pacote e refeito)
    python sync_fiscal.py --so-pacote              # so refaz o pacote do painel
    python sync_fiscal.py --listar                 # mostra o catalogo e sai

Antes da primeira carga, rode o diagnostico_fiscal.py: ele testa as consultas
SEM gravar nada.
"""

from __future__ import annotations

import argparse
import gzip
import sys
from datetime import datetime

import bi_comum as bi

log = bi.configurar_log("sync_fiscal.log")

# Sem isto o bi_comum gravaria o controle_carga no schema do BI COMPRAS.
bi.definir_schema("fiscal")


def _argumentos() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sincroniza GESTAO FISCAL (Oracle/WinThor -> Supabase).")
    p.add_argument("--consulta", nargs="+", metavar="NOME", help="Roda apenas as consultas indicadas.")
    p.add_argument("--so-pacote", action="store_true", help="Nao le o WinThor: so refaz o pacote do painel.")
    p.add_argument("--listar", action="store_true", help="Mostra o catalogo de consultas e sai.")
    return p.parse_args()


def _f(n: int | float | None) -> str:
    return "-" if n is None else f"{n:,.0f}".replace(",", ".")


class _Passo:
    """Um passo que nao e consulta, mas tambem vai para o controle_carga."""

    def __init__(self, nome: str, destino: str):
        self.nome, self.destino, self.linhas_esperadas = nome, destino, None


# ---------------------------------------------------------------------------
# Conferencia: banco x PCTABPR, regiao a regiao
# ---------------------------------------------------------------------------
def conferir_tabela(conn_ora, conn_pg) -> tuple[str, str]:
    """Devolve (status, mensagem)."""
    from consultas_fiscal import sql_conferencia
    with conn_ora.cursor() as cur:
        cur.execute(sql_conferencia())
        ora = {int(r[0]): (int(r[1]), int(r[2]), int(r[3])) for r in cur.fetchall()}
    with conn_pg.cursor() as cur:
        cur.execute(
            """SELECT t.numregiao, COUNT(*),
                      COUNT(*) FILTER (WHERE tr.codst IS NULL),
                      COUNT(*) FILTER (WHERE COALESCE(t.pvenda, 0) <= 0)
                 FROM fiscal.fato_preco_regiao t
                 LEFT JOIN fiscal.tributacao tr ON tr.codst = t.codst
                GROUP BY t.numregiao""")
        pg = {int(r[0]): (int(r[1]), int(r[2]), int(r[3])) for r in cur.fetchall()}
    conn_pg.rollback()
    diferentes = []
    for reg in sorted(set(ora) | set(pg)):
        o, p = ora.get(reg, (0, 0, 0)), pg.get(reg, (0, 0, 0))
        if o != p:
            diferentes.append(f"regiao {reg}: banco {p[0]} linhas / {p[1]} sem trib. / {p[2]} sem preco x "
                              f"WinThor {o[0]} / {o[1]} / {o[2]}")
    tot_o = [sum(x[i] for x in ora.values()) for i in range(3)]
    resumo = (f"{len(ora)} regioes, {_f(tot_o[0])} linhas da PCTABPR, {_f(tot_o[1])} sem tributacao, "
              f"{_f(tot_o[2])} sem preco")
    if not diferentes:
        return "OK", "Banco igual ao WinThor em todas as regioes: " + resumo
    return "AVISO", f"{len(diferentes)} regiao(oes) diferente(s) do WinThor ({resumo}): " + "; ".join(diferentes[:8])


# ---------------------------------------------------------------------------
# Pacote do painel
# ---------------------------------------------------------------------------
def montar_pacote(conn_pg) -> tuple[int, int, str]:
    """Monta o JSON do painel no banco, comprime aqui e guarda em painel_cache."""
    from consultas_fiscal import meses_venda
    with conn_pg.cursor() as cur:
        cur.execute("SET LOCAL statement_timeout = 300000")
        cur.execute("SELECT fiscal.painel_dados(%s)::text", (meses_venda(),))
        texto_json = cur.fetchone()[0]
        bruto = texto_json.encode("utf-8")
        comprimido = gzip.compress(bruto, compresslevel=7)
        versao = datetime.now().strftime("%Y%m%d-%H%M%S")
        cur.execute(
            """INSERT INTO fiscal.painel_cache (id, gerado_em, versao, bytes_json, bytes_gz, payload_gz)
               VALUES (1, now(), %s, %s, %s, %s)
               ON CONFLICT (id) DO UPDATE SET gerado_em = EXCLUDED.gerado_em, versao = EXCLUDED.versao,
                      bytes_json = EXCLUDED.bytes_json, bytes_gz = EXCLUDED.bytes_gz, payload_gz = EXCLUDED.payload_gz""",
            (versao, len(bruto), len(comprimido), bi.psycopg2.Binary(comprimido)))
    conn_pg.commit()
    return len(bruto), len(comprimido), versao


def _dizer_como_esta(conn_pg) -> None:
    """Uma linha de verdade no fim: o que o painel mostra agora. Quem roda o
    ATUALIZAR AGORA.bat le isto, sem abrir o banco."""
    try:
        with conn_pg.cursor() as cur:
            cur.execute("""SELECT COUNT(DISTINCT codprod),
                                  COUNT(*) FILTER (WHERE situacao IN (1, 3, 4)),
                                  COUNT(*) FILTER (WHERE situacao IN (2, 3, 4)),
                                  COUNT(*) FILTER (WHERE situacao = 1)
                             FROM fiscal.vw_situacao""")
            n_p, sem_t, sem_p, so_t = cur.fetchone()
        conn_pg.rollback()
        log.info("PAINEL ATUALIZADO: %s produtos x todas as regioes; %s combinacoes sem tributacao (%s delas com preco), "
                 "%s sem preco de venda.", _f(n_p), _f(sem_t), _f(so_t), _f(sem_p))
    except Exception as exc:  # noqa: BLE001
        conn_pg.rollback()
        log.warning("  nao consegui ler o resumo do painel: %s", exc)


def main() -> int:
    args = _argumentos()
    bi.carregar_env()

    from consultas_fiscal import catalogo, selecionar  # le o ENV: so depois dele

    if args.listar:
        print()
        print(f"{'CONSULTA':14s} {'DESTINO':30s} DESCRICAO")
        print("-" * 100)
        for c in catalogo():
            print(f"{c.nome:14s} {c.destino:30s} {c.descricao}")
        print()
        return 0

    try:
        cfg_ora = bi.OracleConfig.from_env()
        cfg_pg = bi.SupabaseConfig.from_env()
    except SystemExit as exc:
        log.error("Configuracao invalida: %s", exc)
        return 1

    # a lista de regioes mora no banco (fiscal.config): trocar regiao nao exige mexer na VM
    from consultas_fiscal import regioes_do_banco
    regioes_do_banco(cfg_pg, log)

    consultas = [] if args.so_pacote else selecionar(args.consulta)
    if consultas:
        log.info("Vou rodar %d consulta(s): %s", len(consultas), ", ".join(c.nome for c in consultas))
    resultados: list[tuple[str, str, int | None, float]] = []

    try:
        with bi.conectar_oracle(cfg_ora) as conn_ora, bi.conectar_supabase(cfg_pg) as conn_pg, \
             bi.tranca_de_carga(conn_pg, "carga"):
            # uma foto so do WinThor para extracao e conferencia
            foto_unica = False
            if consultas:
                try:
                    with conn_ora.cursor() as cur:
                        cur.execute("SET TRANSACTION READ ONLY")
                    foto_unica = True
                except Exception as exc:  # noqa: BLE001
                    log.warning("  nao consegui abrir a transacao so de leitura no Oracle (%s); sigo sem ela.", exc)

            for consulta in consultas:
                relogio = bi.cronometro()
                log.info("=" * 70)
                log.info("[%s] %s", consulta.nome, consulta.descricao)
                try:
                    if consulta.streaming:
                        linhas = bi.carregar_em_lotes(conn_ora, conn_pg, consulta, tamanho=50000)
                    else:
                        brutas = bi.extrair(conn_ora, consulta)
                        log.info("  Oracle devolveu %s linhas.", _f(len(brutas)))
                        linhas = bi.carregar(conn_pg, consulta, brutas)
                    conn_pg.commit()
                    segundos = relogio()
                    aviso = bi.avaliar_contagem(consulta, linhas)
                    log.info("  OK — %s linhas em %.1fs -> %s", _f(linhas), segundos, consulta.destino)
                    resultados.append((consulta.nome, "OK", linhas, segundos))
                    bi.registrar_execucao(conn_pg, consulta, "OK", linhas, segundos, aviso)
                except Exception as exc:  # noqa: BLE001 — uma falha nao pode derrubar as outras
                    conn_pg.rollback()
                    segundos = relogio()
                    log.exception("  FALHOU: %s", consulta.nome)
                    resultados.append((consulta.nome, "ERRO", None, segundos))
                    bi.registrar_execucao(conn_pg, consulta, "ERRO", None, segundos, f"{type(exc).__name__}: {exc}")

            # --- conferencia contra a PCTABPR ---------------------------------------
            nomes = {c.nome for c in consultas}
            if {"preco_regiao", "tributacao"} <= nomes and all(r[1] == "OK" for r in resultados if r[0] in ("preco_regiao", "tributacao")):
                relogio = bi.cronometro()
                passo = _Passo("conferencia", "fiscal.fato_preco_regiao x PCTABPR")
                try:
                    status, msg = conferir_tabela(conn_ora, conn_pg)
                    if not foto_unica:
                        msg += " (sem transacao so de leitura: diferenca pequena pode ser preco mudado durante a carga)"
                    (log.info if status == "OK" else log.warning)("  conferencia x PCTABPR: %s — %s", status, msg)
                except Exception as exc:  # noqa: BLE001
                    conn_pg.rollback()
                    status, msg = "AVISO", f"Nao consegui conferir: {type(exc).__name__}: {exc}"
                    log.warning("  %s", msg)
                bi.registrar_execucao(conn_pg, passo, status, None, relogio(), msg)
                resultados.append((passo.nome, status, None, relogio()))
            if foto_unica:
                try:
                    conn_ora.rollback()     # encerra a transacao so de leitura
                except Exception:  # noqa: BLE001
                    pass

            # --- pacote do painel ----------------------------------------------------
            relogio = bi.cronometro()
            passo = _Passo("pacote", "fiscal.painel_cache")
            try:
                n_json, n_gz, versao = montar_pacote(conn_pg)
                segundos = relogio()
                msg = f"versao {versao}: JSON de {n_json / 1024:.0f} KB, {n_gz / 1024:.0f} KB comprimido"
                log.info("  pacote do painel pronto em %.1fs — %s", segundos, msg)
                bi.registrar_execucao(conn_pg, passo, "OK", None, segundos, msg)
                resultados.append((passo.nome, "OK", None, segundos))
            except Exception as exc:  # noqa: BLE001
                conn_pg.rollback()
                segundos = relogio()
                log.exception("  FALHOU o pacote do painel (a tela segue com o pacote anterior)")
                bi.registrar_execucao(conn_pg, passo, "ERRO", None, segundos, f"{type(exc).__name__}: {exc}")
                resultados.append((passo.nome, "ERRO", None, segundos))

            _dizer_como_esta(conn_pg)
            log.info("=" * 70)
            log.info("RESUMO DA CARGA")
            log.info("%-18s %-6s %12s %9s", "PASSO", "STATUS", "LINHAS", "TEMPO")
            for nome, status, linhas, segundos in resultados:
                log.info("%-18s %-6s %12s %8.1fs", nome, status, _f(linhas), segundos)
            log.info("=" * 70)

    except bi.CargaJaRodando as aviso:
        # Nao e erro: e a tranca fazendo o trabalho dela. Sair com 0 evita que o
        # Agendador fique reiniciando uma tarefa que esta certa em nao rodar.
        log.warning("%s", aviso)
        return 0
    except Exception:
        log.exception("Nao consegui nem abrir as conexoes — nada foi carregado.")
        return 1

    falhas = [r for r in resultados if r[1] == "ERRO"]
    if falhas:
        log.error("%d passo(s) falharam: %s", len(falhas), ", ".join(r[0] for r in falhas))
        return 1
    log.info("Carga concluida.")
    return 0


if __name__ == "__main__":
    try:
        codigo = main()
    except Exception:
        log.exception("Erro inesperado — veja o traceback acima / no sync_fiscal.log.")
        codigo = 1
    sys.exit(codigo)
