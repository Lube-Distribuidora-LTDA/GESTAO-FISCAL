/* =============================================================================
 * comum.js — peças que as telas dividem: formatos, chips de região, a tabela de
 * produtos com as regiões sem tributação e sem preço, a lista de combinações
 * produto × região e o clique padrão (abre o relatório; Ctrl+clique filtra).
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

/* ------------------------------ formatos ------------------------------ */
L.fR = function (v) { return L.fBRL(v, 0); };
L.fRc = function (v) { return L.fAbrev(v, true); };
L.fRk = function (v) { return Math.abs(v) >= 1e6 ? L.fAbrev(v, true) : L.fBRL(v, 0); };
L.fPreco = function (v) { return v > 0 ? L.fBRL(v, v < 1 ? 4 : 2) : "—"; };
L.fQ = function (v) { return v == null || isNaN(v) ? "—" : L.fNum(v, Math.abs(v % 1) > 0.0005 ? (Math.abs(v) < 10 ? 2 : 1) : 0); };
L.fAliq = function (v) { return v == null ? "" : L.fNum(v, v % 1 ? 2 : 0) + "%"; };

/* ------------------------------ clique padrão ------------------------------ */
/* abre o relatório do item; Ctrl+clique aplica como filtro (se a tela tem esse filtro) */
L.clique = function (dim, id, ev, extra) {
  var pag = L.paginaAtual(), filtraveis = (pag.filtros || []).concat(pag.mais || []);
  if (ev && (ev.ctrlKey || ev.metaKey) && L.DIM[dim] && filtraveis.indexOf(dim) >= 0) { L.alternarFiltro(dim, id); L.toast("Filtro: " + L.nomeDe(dim, id)); return; }
  L.abrirDossie(Object.assign({ dim: dim, id: id }, extra || {}), !!(L.dossieAberto && L.dossieAberto()));
};

/* ------------------------------ chips de região ------------------------------ */
/* uma lista de regiões (índices) vira chips com o número; o nome aparece na dica.
   tipo: "t" (sem tributação) ou "p" (sem preço). Cada chip abre o relatório da região. */
L.chipsRegioes = function (lista, pi, tipo) {
  var R = L.R, C = L.C, box = L.h("span", { class: "chips-reg" });
  if (!lista.length) { box.appendChild(L.h("span", { class: "chip-nada", text: "nenhuma" })); return box; }
  lista.forEach(function (ri) {
    var c = pi * R.n + ri, s = C.s[c], vendeu = C.vn[c] > 0;
    var ch = L.h("button", { type: "button", class: "chip-reg s" + s + (vendeu ? " vendeu" : ""), text: String(R.num[ri]) });
    ch.addEventListener("mousemove", function (ev) { L.dica.mostrar(ev, L.dicaCelula(c)); });
    ch.addEventListener("mouseleave", L.dica.esconder);
    ch.addEventListener("click", function (ev) { ev.stopPropagation(); L.clique("regiao", R.num[ri], ev); });
    box.appendChild(ch);
  });
  return box;
};
L.textoRegioes = function (lista) { return lista.map(function (ri) { return L.R.num[ri] + " " + L.R.nome[ri]; }).join("; "); };

/* dica (tooltip) de uma célula produto × região */
L.dicaCelula = function (c) {
  var C = L.C, R = L.R, P = L.P, pi = L.celPi(c), ri = L.celRi(c), s = C.s[c], sit = L.SITUACOES[s], linhas = [];
  linhas.push({ rot: "Situação", val: sit.nome, cor: L.corSit(s) });
  linhas.push({ rot: "Tributação", val: C.st[c] ? C.st[c] + " · " + L.descTrib(C.st[c]) : "sem tributação" });
  var t = C.st[c] ? L.T.get(C.st[c]) : null;
  if (t) linhas.push({ rot: "CST · ICMS · CFOP", val: (t.cst || "—") + " · " + (L.fAliq(t.aliq) || "—") + " · " + (t.cfop || "—") });
  linhas.push({ rot: "Preço de venda", val: L.fPreco(C.pv[c]) });
  linhas.push({ rot: "Venda na região (" + L.META.meses_venda + " meses)", val: C.vn[c] ? L.fR(C.vv[c]) + " · " + L.fInt(C.vn[c]) + " linhas · última " + L.fDia(C.vd[c]) : "não vendeu" });
  return { titulo: P.desc[pi] + " · região " + L.nomeRegiao(ri), linhas: linhas, extra: '<div class="dica-sub">' + L.esc(sit.dica) + "</div>", clique: "Clique para abrir o relatório" };
};

/* ------------------------------ tabela de produtos ------------------------------ */
/* linhas = L.porProduto(sel). Colunas do pedido do Fiscal primeiro:
   Código | Descrição | Regiões sem tributação | Regiões sem preço de venda */
L.colunasProduto = function () {
  var P = L.P;
  return [
    { id: "desc", titulo: "Descrição", tipo: "texto", valor: function (x) { return P.desc[x.pi]; } },
    { id: "cod", titulo: "Código", tipo: "inteiro", valor: function (x) { return P.cod[x.pi]; }, fmt: function (v) { return String(v); }, somar: false },
    { id: "st", titulo: "Regiões sem tributação", tipo: "texto", alinhar: "esq", valor: function (x) { return x.semTrib.length; }, ordVal: function (x) { return x.semTrib.length; },
      fmt: function (v, x) { return { html: "" }; }, celula: function (x) { return L.chipsRegioes(x.semTrib, x.pi, "t"); }, exp: function (x) { return L.textoRegioes(x.semTrib); },
      dica: "Regiões em que o produto está sem tributação (CODST): com ou sem preço. Vermelho = tem preço e falta a tributação. Contorno = vendeu nessa região nos últimos meses." },
    { id: "sp", titulo: "Regiões sem preço de venda", tipo: "texto", alinhar: "esq", valor: function (x) { return x.semPreco.length; }, ordVal: function (x) { return x.semPreco.length; },
      fmt: function () { return { html: "" }; }, celula: function (x) { return L.chipsRegioes(x.semPreco, x.pi, "p"); }, exp: function (x) { return L.textoRegioes(x.semPreco); },
      dica: "Regiões em que o produto está sem preço de venda (PVENDA zero ou vazio): com ou sem tributação. Âmbar = tem tributação e falta o preço." },
    { id: "nst", titulo: "Qtd. sem tributação", tipo: "inteiro", valor: function (x) { return x.semTrib.length; }, somar: false },
    { id: "nsp", titulo: "Qtd. sem preço", tipo: "inteiro", valor: function (x) { return x.semPreco.length; }, somar: false },
    { id: "ok", titulo: "Regiões completas", tipo: "inteiro", valor: function (x) { return x.sit[0]; }, fmt: function (v, x) { return v + " de " + x.n; }, exp: function (x) { return x.sit[0]; }, somar: false, essencial: false },
    { id: "vp", titulo: "Vendeu e tem pendência", tipo: "inteiro", valor: function (x) { return x.vendPend; }, fmt: function (v) { return v ? v + (v > 1 ? " regiões" : " região") : ""; }, exp: function (x) { return x.vendPend; }, somar: false, essencial: false,
      dica: "Em quantas das regiões com pendência o produto vendeu nos últimos meses" },
    { id: "forn", titulo: "Fornecedor", tipo: "texto", valor: function (x) { return L.nomeDe("fornecedor", P.forn[x.pi]); }, essencial: false },
    { id: "dep", titulo: "Departamento", tipo: "texto", valor: function (x) { return L.nomeDe("depto", P.dep[x.pi]); }, essencial: false },
    { id: "sec", titulo: "Seção", tipo: "texto", valor: function (x) { return L.nomeDe("secao", P.sec[x.pi]); }, essencial: false },
    { id: "ncm", titulo: "NCM", tipo: "texto", valor: function (x) { return L.fNcm(P.ncm[x.pi]); }, essencial: false },
    { id: "situ", titulo: "Situação", tipo: "texto", valor: function (x) { return P.fl[x.pi] ? "Fora de linha" : "Ativo"; }, essencial: false },
    { id: "est", titulo: "Estoque", tipo: "num", valor: function (x) { return P.est[x.pi]; }, fmt: L.fQ, exportarTipo: "inteiro", essencial: false },
    { id: "vv", titulo: "Venda " + L.META.meses_venda + " meses (R$)", tipo: "moedaInt", valor: function (x) { return x.vv; }, fmt: function (v) { return v ? L.fR(v) : "—"; }, exportarTipo: "moeda", barra: true, dica: "Venda faturada do produto nas regiões da tela (a lista começa pelo que mais vende)" },
    { id: "cad", titulo: "Cadastrado em", tipo: "texto", valor: function (x) { return P.cad[x.pi]; }, fmt: function (v) { return v >= 0 ? L.fDia(v) : "—"; }, exp: function (x) { return P.cad[x.pi] >= 0 ? L.fDia(P.cad[x.pi]) : ""; }, essencial: false },
  ];
};
L.tabelaProdutos = function (linhas, cfg) {
  cfg = cfg || {};
  var P = L.P;
  return L.tabela(Object.assign({
    titulo: "Produtos — regiões sem tributação e sem preço de venda", arquivo: "fiscal-regioes-sem-tributacao-e-preco", aba: "Produtos", porPagina: 25,
    ordem: { id: "vv", desc: true }, linhas: linhas, colunas: L.colunasProduto(), foto: function (x) { return x.pi; }, fotoColuna: "desc",
    buscaDica: "Buscar produto por código, nome, NCM ou fornecedor…",
    buscaTexto: function (x) { return P.cod[x.pi] + " " + P.desc[x.pi] + " " + P.ncm[x.pi] + " " + L.nomeDe("fornecedor", P.forn[x.pi]); },
    totais: function (res) {
      var l = res.todas || res.linhas, st = 0, sp = 0, ct = 0, cp = 0;
      l.forEach(function (x) { if (x.semTrib.length) st++; if (x.semPreco.length) sp++; ct += x.semTrib.length; cp += x.semPreco.length; });
      return [{ rot: "Produtos", valor: L.fInt(l.length), pri: true }, { rot: "Com região sem tributação", valor: L.fInt(st) + " (" + L.fInt(ct) + " regiões)" }, { rot: "Com região sem preço", valor: L.fInt(sp) + " (" + L.fInt(cp) + " regiões)" }];
    },
    aoClicar: function (x, ev) { L.clique("produto", P.cod[x.pi], ev); },
    vazio: "Nenhum produto com os filtros atuais.",
  }, cfg));
};

/* ------------------------------ combinações produto × região ------------------------------ */
L.tabelaCelulas = function (cels, cfg) {
  cfg = cfg || {};
  var C = L.C, P = L.P, R = L.R;
  return L.tabela(Object.assign({
    titulo: "Combinações produto × região", arquivo: "fiscal-produto-regiao", aba: "Produto x região", porPagina: 25, ordem: { id: "vv", desc: true },
    linhas: cels, foto: function (c) { return L.celPi(c); }, fotoColuna: "desc",
    buscaTexto: function (c) { var pi = L.celPi(c), ri = L.celRi(c); return P.cod[pi] + " " + P.desc[pi] + " " + R.num[ri] + " " + R.nome[ri] + " " + C.st[c]; },
    colunas: [
      { id: "desc", titulo: "Produto", tipo: "texto", valor: function (c) { return P.desc[L.celPi(c)]; } },
      { id: "cod", titulo: "Código", tipo: "inteiro", valor: function (c) { return P.cod[L.celPi(c)]; }, fmt: function (v) { return String(v); }, somar: false },
      { id: "reg", titulo: "Região", tipo: "texto", valor: function (c) { return L.nomeRegiao(L.celRi(c)); }, ordVal: function (c) { return R.num[L.celRi(c)]; } },
      { id: "sit", titulo: "Situação", tipo: "tag", valor: function (c) { return L.SITUACOES[C.s[c]].nome; }, fmt: function (v, c) { return { html: L.tagSit(C.s[c]) }; }, ordVal: function (c) { return C.s[c]; } },
      { id: "trib", titulo: "Tributação", tipo: "texto", valor: function (c) { return C.st[c] ? C.st[c] + " · " + L.descTrib(C.st[c]) : ""; } },
      { id: "pv", titulo: "Preço de venda", tipo: "num2", valor: function (c) { return C.pv[c] || null; }, fmt: function (v) { return L.fPreco(v); }, exportarTipo: "moeda", somar: false },
      { id: "vv", titulo: "Venda na região (R$)", tipo: "moedaInt", valor: function (c) { return C.vv[c] || null; }, fmt: function (v) { return v ? L.fR(v) : ""; }, exportarTipo: "moeda" },
      { id: "vd", titulo: "Última venda", tipo: "texto", valor: function (c) { return C.vd[c]; }, fmt: function (v) { return v >= 0 ? L.fDia(v) : ""; }, exp: function (c) { return C.vd[c] >= 0 ? L.fDia(C.vd[c]) : ""; } },
      { id: "forn", titulo: "Fornecedor", tipo: "texto", valor: function (c) { return L.nomeDe("fornecedor", P.forn[L.celPi(c)]); }, essencial: false },
      { id: "dep", titulo: "Departamento", tipo: "texto", valor: function (c) { return L.nomeDe("depto", P.dep[L.celPi(c)]); }, essencial: false },
      { id: "est", titulo: "Estoque", tipo: "num", valor: function (c) { return P.est[L.celPi(c)]; }, fmt: L.fQ, exportarTipo: "inteiro", essencial: false },
    ],
    totais: function (res) { var l = res.todas || res.linhas, v = 0, ps = new Set(); l.forEach(function (c) { v += C.vv[c]; ps.add(L.celPi(c)); });
      return [{ rot: "Combinações", valor: L.fInt(l.length), pri: true }, { rot: "Produtos", valor: L.fInt(ps.size) }, { rot: "Venda nessas regiões", valor: L.fR(v) }]; },
    aoClicar: function (c, ev) { L.clique("produto", P.cod[L.celPi(c)], ev); },
    vazio: "Nenhuma combinação com os filtros atuais.",
  }, cfg));
};

/* barras 100% da situação por região (Visão geral, relatórios) */
L.graficoSituacaoRegiao = function (box, sel, aoClicar) {
  var linhas = L.porRegiao(sel);
  L.graf.barras100(box, {
    linhas: linhas.map(function (x) { return { rot: L.nomeRegiao(x.ri), partes: [0, 1, 2, 3, 4].map(function (s) { return { valor: x.sit[s], cor: L.corSit(s), corTexto: s === 0 || s === 2 ? "#0b1533" : "#fff" }; }) }; }),
    linhaH: 30, fmtPct: function (p) { return L.fNum(p, 0) + "%"; },
    fmtTotal: function (pt) { var pend = pt[1].valor + pt[2].valor + pt[3].valor + pt[4].valor; return pend ? L.fInt(pend) + " pend." : "completa"; },
    dica: function (i, s) {
      var x = linhas[i], ri = x.ri, R = L.R, l = [0, 1, 2, 3, 4].map(function (k) { return { rot: L.SITUACOES[k].nome, cor: L.corSit(k), val: L.fInt(x.sit[k]) + " (" + L.fPct(x.n ? x.sit[k] / x.n : 0, 1) + ")" }; });
      l.push({ rot: "Clientes ativos", val: L.fInt(R.cliA[ri]) });
      l.push({ rot: "Venda (" + L.META.meses_venda + " meses)", val: R.vL[ri] ? L.fR(R.vV[ri]) + " · " + L.fInt(R.vP[ri]) + " produtos" : "sem venda" });
      return { titulo: "Região " + L.nomeRegiao(ri) + " · " + R.uf[ri], linhas: l };
    },
    aoClicar: function (i, s, ev) { aoClicar ? aoClicar(linhas[i], s, ev) : L.clique("regiao", L.R.num[linhas[i].ri], ev, s != null ? { f: { pendencia: [s] } } : null); },
  });
  return linhas;
};
L.legendaSituacoes = function () { return L.graf.legenda(L.SITUACOES.map(function (s) { return { rot: s.nome, cor: L.corSit(s.id) }; })); };

/* segmento "Com pendência | Todos" das listas de produto */
L.segPendentes = function (chave, atual, aoMudar) {
  var seg = L.h("div", { class: "seg", title: "Mostrar só os produtos com alguma região sem tributação ou sem preço" });
  [["com", "Com pendência"], ["todos", "Todos"]].forEach(function (o) {
    seg.appendChild(L.h("button", { type: "button", class: atual === o[0] ? "on" : "", text: o[1], onclick: function () { aoMudar(o[0]); } }));
  });
  return seg;
};

})();
