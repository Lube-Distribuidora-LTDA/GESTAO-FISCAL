/* =============================================================================
 * pag-produtos.js — PRODUTOS: a lista pedida pelo Fiscal.
 *   Código | Descrição | Regiões sem tributação | Regiões sem preço de venda
 * Cada região é um chip com o número (o nome na dica): vermelho = tem preço e falta a
 * tributação; âmbar = tem tributação e falta o preço; roxo = sem os dois; cinza = fora
 * da tabela da região. Contorno dourado = o produto vendeu naquela região nos últimos
 * meses. Clique no chip abre a região; na linha, o produto.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var MAIS = ["uf", "filialReg", "secao", "produto", "ncm", "trib", "estoque", "venda", "cadastro", "vendaReg"];

L.registrarPagina({
  id: "produtos", grupo: "Tributação e preço", menu: "Produtos", icone: "tabela",
  titulo: "Produtos sem tributação ou sem preço", olho: "Código · descrição · regiões sem tributação · regiões sem preço de venda", semPeriodo: true,
  filtros: ["regiao", "pendencia", "depto", "fornecedor", "situacaoProd"], mais: MAIS,
  render: render,
});

function render(raiz) {
  var sel = L.filtrar(L.spec()), modo = L.estado.pend || "com";
  var linhas = L.porProduto(sel, modo === "com"), r = L.resumo(sel);
  raiz.appendChild(L.kpis(
    L.kpi({ icone: "caixa", rot: modo === "com" ? "Produtos com pendência" : "Produtos na lista", valor: linhas.length, fmt: L.fInt, classe: "heroi", leg: L.h("span", { text: "de " + L.fInt(r.prod) + " produtos de revenda · " + r.reg + " regiões" }) }),
    L.kpi({ icone: "percent", rot: "Com região sem tributação", valor: r.prodSemTrib, fmt: L.fInt, classe: r.prodSemTrib ? "perigo" : "zero", leg: L.h("span", { text: L.fInt(r.celSemTrib) + " regiões · " + L.fInt(r.porSit[1]) + " com preço" }) }),
    L.kpi({ icone: "etiqueta", rot: "Com região sem preço de venda", valor: r.prodSemPreco, fmt: L.fInt, classe: r.prodSemPreco ? "atencao" : "zero", leg: L.h("span", { text: L.fInt(r.celSemPreco) + " regiões · " + L.fInt(r.porSit[2]) + " com tributação" }) }),
    L.kpi({ icone: "verificar", rot: "Completos em todas as regiões", valor: r.prodCompleto, fmt: L.fInt, classe: "ok", leg: L.h("span", { text: L.fPct(r.prod ? r.prodCompleto / r.prod : null, 1) + " dos produtos" }) })));

  var tab = L.tabelaProdutos(linhas, {
    extraTopo: function () { return L.segPendentes("pend", modo, function (m) { L.estado.pend = m; L.sincronizarHash(); L.emitir("filtros"); }); },
    filtrosTexto: function () { return L.descricaoFiltros([["Lista", modo === "com" ? "só produtos com alguma região sem tributação ou sem preço" : "todos os produtos"]]); },
  });
  raiz.appendChild(L.grade(L.painel({ titulo: "Regiões sem tributação e sem preço de venda, produto a produto", sub: "clique no número da região para abrir a região · na linha, o relatório do produto · Excel leva os nomes das regiões", classe: "c-12", semPad: true, corpo: tab,
    acoes: legendaChips() })));
  raiz.appendChild(L.nota("Chip vermelho: tem preço na região e falta a tributação. Âmbar: tem tributação e falta o preço. Roxo: a linha da 201 existe, mas sem os dois. Cinza: o produto nunca foi precificado na região. Contorno dourado: vendeu na região nos últimos " + L.META.meses_venda + " meses. Com o filtro \"Situação na região\", só as situações marcadas entram nas listas."));
}

function legendaChips() {
  return L.h("div", { class: "leg-chips" },
    [[1, "Sem tributação"], [2, "Sem preço"], [3, "Sem os dois"], [4, "Fora da 201"]].map(function (x) { return L.h("span", null, L.h("i", { class: "chip-reg s" + x[0], text: "18" }), x[1]); }),
    L.h("span", null, L.h("i", { class: "chip-reg s1 vendeu", text: "18" }), "Vendeu na região"));
}

})();
