-- =============================================================================
-- Migração fiscal_03_regioes_escolhidas (2026-10-20)
-- Pedido do Júlio: "eu preciso de apenas algumas regiões: 18, 19, 23, 31, 33, 35, 39,
-- 40, 41, 42, 43, 46, 27, 37, 38, 45". A carga marca essas regiões em
-- fiscal.regiao.no_painel (lista no ENV FISCAL_REGIOES) e só traz preço, tributação e
-- venda delas; a regra (vw_situacao) e o pacote (painel_dados) passam a olhar só
-- produtos de revenda não excluídos × regiões marcadas.
-- A definição vigente da view e da função está em 02-situacao-e-funcao.sql.
-- =============================================================================
alter table fiscal.regiao add column if not exists no_painel boolean not null default false;

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
