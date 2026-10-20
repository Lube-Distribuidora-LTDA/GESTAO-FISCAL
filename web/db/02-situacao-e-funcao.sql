-- =============================================================================
-- Migração fiscal_02_situacao_e_funcao (2026-10-20) — definição vigente (com a 03).
--
-- Universo: produtos DE REVENDA e NÃO EXCLUÍDOS × as regiões escolhidas (regiao.no_painel,
-- marcada pela carga a partir do ENV FISCAL_REGIOES; pedido do Júlio em 2026-10-20).
--
-- fiscal.vw_situacao : a REGRA, num lugar só. Para cada produto não excluído × cada
--                      região, a situação de hoje:
--     0  completo                       tem tributação e preço de venda
--     1  sem tributação                 tem preço, falta a tributação (CODST nulo ou inexistente na PCTRIBUT)
--     2  sem preço de venda             tem tributação, falta o preço (PVENDA nulo ou zero)
--     3  sem tributação e sem preço     a linha existe na 201, mas vazia
--     4  fora da tabela da região       não há linha na PCTABPR (nunca precificado na região)
--   "Região sem tributação" de um produto = situações 1, 3 e 4; "sem preço de venda" = 2, 3 e 4.
--
-- fiscal.painel_dados(meses) : o pacote inteiro do painel em JSON (o navegador filtra e soma).
--   A matriz produto × região vai achatada (produto a produto, região a região, na ordem
--   de "produtos" e "regioes"): m = situação (um caractere por região), st = CODST (0 = sem),
--   pv = preço de venda (0 = sem).
--   Lê trade.produto_miniatura SÓ para saber quais produtos têm foto (leitura, não carga).
-- =============================================================================

create or replace view fiscal.vw_situacao as
select p.codprod,
       r.numregiao,
       t.codst,
       t.pvenda,
       t.ptabela,
       t.dt_alt_preco,
       t.rotina,
       (tr.codst is not null)                    as tributacao_existe,
       case when t.codprod is null then 4
            when tr.codst is null and coalesce(t.pvenda, 0) <= 0 then 3
            when tr.codst is null then 1
            when coalesce(t.pvenda, 0) <= 0 then 2
            else 0 end                           as situacao
  from fiscal.produto p
 cross join fiscal.regiao r
  left join fiscal.fato_preco_regiao t on t.codprod = p.codprod and t.numregiao = r.numregiao
  left join fiscal.tributacao tr on tr.codst = t.codst
 where not p.excluido and p.revenda and r.no_painel;

comment on view fiscal.vw_situacao is
  'Situação de cada produto × região: 0 completo, 1 sem tributação, 2 sem preço de venda, 3 sem os dois, 4 fora da tabela da região (sem linha na PCTABPR).';

create or replace function fiscal.painel_dados(meses integer default 12)
returns json
language sql
stable
set search_path = fiscal, pg_temp
as $$
with
venda_reg as (
  select v.numregiao, sum(v.linhas) as linhas, sum(v.valor) as valor, count(*) as produtos, max(v.ultima_venda) as ultima
    from fiscal.fato_venda_regiao v
    join fiscal.produto p on p.codprod = v.codprod and not p.excluido and p.revenda
   group by v.numregiao
),
reg as (
  select r.*, coalesce(v.linhas, 0) as v_linhas, coalesce(v.valor, 0) as v_valor, coalesce(v.produtos, 0) as v_produtos,
         v.ultima as v_ultima, (row_number() over (order by r.numregiao) - 1)::int as ri
    from fiscal.regiao r
    left join venda_reg v on v.numregiao = r.numregiao
   where r.no_painel
),
prod as (
  select p.*, (row_number() over (order by p.codprod) - 1)::int as pi
    from fiscal.produto p
   where not p.excluido and p.revenda
),
cel as materialized (
  select p.pi, g.ri, s.situacao, coalesce(s.codst, 0) as codst, coalesce(s.pvenda, 0)::float8 as pvenda
    from fiscal.vw_situacao s
    join prod p on p.codprod = s.codprod
    join reg g on g.numregiao = s.numregiao
),
lin as (
  select pi, string_agg(situacao::text, '' order by ri) as m from cel group by pi
)
select json_build_object(
  'meta', json_build_object(
      'gerado_em', now(),
      'meses_venda', meses,
      'carga', (select max(executado_em) from fiscal.controle_carga where consulta = 'preco_regiao' and status = 'OK'),
      'carga_venda', (select max(executado_em) from fiscal.controle_carga where consulta = 'venda_regiao' and status = 'OK'),
      'n_prod', (select count(*) from prod),
      'n_reg', (select count(*) from reg),
      'n_reg_total', (select count(*) from fiscal.regiao)),
  'regioes', (select coalesce(json_agg(json_build_array(numregiao, regiao, uf, codfilial, case when ativa then 1 else 0 end,
                       clientes_ativos, clientes_compraram, v_linhas, round(v_valor, 2), v_produtos, v_ultima) order by ri), '[]') from reg),
  'trib', (select coalesce(json_agg(json_build_array(t.codst, t.mensagem, t.sittribut, t.aliq_icms, t.cfop, t.cfop_inter, t.obs,
                       t.iva, t.perc_base_red) order by t.codst), '[]')
             from fiscal.tributacao t where t.codst in (select distinct codst from cel where codst <> 0)),
  'fornecedores', (select coalesce(json_agg(json_build_array(codfornec, fornecedor) order by codfornec), '[]')
                     from (select distinct on (codfornec) codfornec, fornecedor from prod where codfornec is not null order by codfornec) f),
  'deptos', (select coalesce(json_agg(json_build_array(codepto, departamento) order by codepto), '[]')
               from (select distinct on (codepto) codepto, departamento from prod where codepto is not null order by codepto) d),
  'secoes', (select coalesce(json_agg(json_build_array(codsec, secao, codepto) order by codsec), '[]')
               from (select distinct on (codsec) codsec, secao, codepto from prod where codsec is not null order by codsec) s),
  'produtos', (select coalesce(json_agg(json_build_array(codprod, descricao, embalagem, unidade, codfornec, codepto, codsec,
                       case when fora_de_linha then 1 else 0 end, case when revenda then 1 else 0 end, ncm,
                       estoque::float8, dtcadastro) order by pi), '[]') from prod),
  'm',  (select coalesce(json_agg(m order by pi), '[]') from lin),
  'st', (select coalesce(json_agg(codst order by pi, ri), '[]') from cel),
  'pv', (select coalesce(json_agg(pvenda order by pi, ri), '[]') from cel),
  'vd', (select json_build_object(
                 'p', coalesce(json_agg(v.codprod order by v.codprod, v.numregiao), '[]'),
                 'r', coalesce(json_agg(v.numregiao order by v.codprod, v.numregiao), '[]'),
                 'n', coalesce(json_agg(v.linhas order by v.codprod, v.numregiao), '[]'),
                 'v', coalesce(json_agg(round(v.valor, 2) order by v.codprod, v.numregiao), '[]'),
                 'd', coalesce(json_agg(v.ultima_venda order by v.codprod, v.numregiao), '[]'))
           from fiscal.fato_venda_regiao v
           join prod p on p.codprod = v.codprod
           join reg g on g.numregiao = v.numregiao),
  'fotos', (select coalesce(json_agg(m.codprod order by m.codprod), '[]')
              from trade.produto_miniatura m where m.codprod in (select codprod from prod))
);
$$;

comment on function fiscal.painel_dados(integer) is
  'Pacote do painel GESTÃO FISCAL (tributação e preço por região). A carga comprime e guarda em fiscal.painel_cache.';

revoke all on function fiscal.painel_dados(integer) from public, anon, authenticated;
