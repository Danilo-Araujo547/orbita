select rel."DT_EMPRESTIMO",rel."DS_FORNECEDOR",rel."PRODUTO",rel."CPRODUTO",rel."UNIDADE",rel."QT_ENTRADA",rel."VL_UNITARIO",rel."VL_TOTAL",rel."TP_EMPRESTIMO",rel."TP_EMPRESTIMO_2",rel."VL_FATOR",rel."CD_ESTOQUE",rel."CD_FORNECEDOR",(EP.QT_ESTOQUE_ATUAL / NULLIF(REL.VL_FATOR, 0)) QT_ESTOQUE_ATUAL, L.DS_LOCALIZACAO
from (

Select Dt_emprestimo,
       Ds_Fornecedor,
       Produto,
       cProduto,
       Unidade,
       Qt_entrada,
       vl_unitario,
       Vl_total,
       Tp_emprestimo,
       tp_emprestimo_2,
       vl_fator,
       cd_estoque,
       cd_fornecedor
  From (Select Ent_pro.dt_entrada Dt_emprestimo,
               Fornecedor.nm_fornecedor ds_fornecedor,
               Produto.ds_produto produto,
               Produto.cd_produto cProduto,
               Uni_pro.ds_unidade unidade,
               Itent_pro.qt_entrada qt_entrada,
               Itent_pro.vl_unitario vl_unitario,
               (Nvl(ItEnt_Pro.Qt_Entrada, 0) * Nvl(Vl_Custo_Real, 0)) vl_Total,
               decode(dbamv.pkg_mges_emprestimo .
                      retorna_tp_emprestimo_ent(itent_pro.cd_itent_pro),
                      'PEC',
                      'Pagto Empréstimo Concedido',
                      'E. Recebido') tp_emprestimo,
               decode(dbamv.pkg_mges_emprestimo .
                      retorna_tp_emprestimo_ent(itent_pro.cd_itent_pro),
                      'PEC',
                      'PEC',
                      'ER') tp_emprestimo_2,
               uni_pro.vl_fator,
               estoque.cd_estoque,
               fornecedor.cd_fornecedor
          From Dbamv.Ent_pro Ent_pro,
               Dbamv.Itent_pro Itent_pro,
               Dbamv.Estoque Estoque,
               Dbamv.Tip_doc Tip_doc,
               Dbamv.Fornecedor Fornecedor,
               Dbamv.Produto Produto,
               Dbamv.Uni_pro Uni_pro
         Where Ent_Pro.Cd_Ent_Pro = ItEnt_Pro.Cd_Ent_Pro
           AND Ent_Pro.Cd_Estoque = Estoque.Cd_Estoque
           AND Tip_Doc.Tp_Entrada = 'E'
           AND Uni_Pro.Cd_Uni_Pro(+) = ItEnt_Pro.Cd_Uni_Pro
           AND Ent_Pro.Cd_Tip_Doc = Tip_Doc.Cd_Tip_Doc
           AND Estoque.Cd_Multi_Empresa = 1
           And Ent_pro.cd_fornecedor = Fornecedor.cd_fornecedor
           And Itent_pro.cd_produto = Produto.cd_produto
           AND ((EXISTS (SELECT 'X'
                           FROM dbamv.itmvto_ent ie
                          WHERE ie.cd_itent_pro = ItEnt_Pro.cd_itent_pro) And
                Nvl(Itent_pro.sn_pendencia, 'N') =
                decode('P',
                               'A',
                               Nvl(Itent_pro.sn_pendencia, 'N'),
                               'E',
                               'N',
                               'P',
                               'S')) OR
               (NOT EXISTS
                (SELECT 'X'
                    FROM dbamv.itmvto_ent ie
                   WHERE ie.cd_itent_pro = ItEnt_Pro.cd_itent_pro) AND
                'P' IN ('A', 'P')))
           AND dbamv.pkg_mges_emprestimo.retorna_tp_emprestimo_ent(Itent_Pro.Cd_Itent_Pro) IN
               ('ER', 'PER', 'PEC')
        union all

        Select Dt_emprestimo,
               Ds_fornecedor,
               Produto,
               cProduto,
               Unidade,
               Qt_entrada,
               vl_unitario,
               vl_total,
               decode(dbamv.pkg_mges_emprestimo .
                      retorna_tp_emprestimo_sai(cd_itmvto_estoque),
                      'PER',
                      'Pagto de Empréstimo Recebido',
                      'E. Concedido') tp_emprestimo,
               decode(dbamv.pkg_mges_emprestimo .
                      retorna_tp_emprestimo_sai(cd_itmvto_estoque),
                      'PER',
                      'PER',
                      'EC') tp_emprestimo_2,
               vl_fator,
               cd_estoque,
               cd_fornecedor
          From (SELECT mvto_estoque.dt_mvto_estoque dt_emprestimo,
                       FORNECEDOR.CD_FORNECEDOR,
                       fornecedor.nm_fornecedor Ds_fornecedor,
                       Produto.ds_produto Produto,
                       Produto.cd_produto cProduto,
                       Uni_pro.ds_unidade Unidade,
                       ItMvto_Estoque.Qt_Movimentacao Qt_entrada,
                       mvto_estoque.hr_mvto_estoque hr_mvto_estoque,
                       itmvto_estoque.cd_produto cd_produto,
                       (uni_pro .
                        Vl_Fator *
                        Verif_Vl_Custo_Medio(produto.Cd_Produto,
                                             mvto_estoque.dt_mvto_estoque,
                                             'H',
                                             null,
                                             mvto_estoque.hr_mvto_estoque)) Vl_Unitario,
                       (ItMvto_Estoque.Qt_Movimentacao * uni_pro.Vl_Fator *
                        Verif_Vl_Custo_Medio(produto.Cd_Produto,
                                             mvto_estoque.dt_mvto_estoque,
                                             'H',
                                             null,
                                             mvto_estoque.hr_mvto_estoque)) vl_total,
                       uni_pro.Vl_Fator vl_fator,
                       itmvto_estoque.cd_itmvto_estoque cd_itmvto_estoque,
                       estoque.cd_estoque
                  FROM Dbamv.Mvto_Estoque,
                       Dbamv.Uni_Pro,
                       Dbamv.ItMvto_Estoque,
                       Dbamv.Estoque,
                       Dbamv.Produto,
                       Dbamv.Fornecedor
                 WHERE 1=1 
                   AND Mvto_Estoque.Cd_Estoque = Estoque.Cd_Estoque
                   AND ItMvto_Estoque.Cd_Mvto_Estoque = Mvto_Estoque.Cd_Mvto_Estoque
                   AND ItMvto_Estoque.Cd_Produto = Produto.Cd_Produto
                   AND Uni_Pro.Cd_Uni_Pro(+) = ItMvto_Estoque.Cd_Uni_Pro
                   AND Estoque.Cd_Multi_Empresa = 1
                   AND mvto_estoque.tp_mvto_estoque = 'E'
                   AND mvto_estoque.cd_fornecedor = fornecedor.cd_fornecedor
                   AND ((EXISTS (SELECT 'X'
                                   FROM dbamv.itmvto_ent ie
                                  WHERE ie.cd_itmvto_estoque = ItMvto_Estoque.cd_itmvto_estoque) And
                        Nvl(Itmvto_estoque.sn_pendencia, 'N') =
                        decode('P',
                                       'A',
                                       Nvl(Itmvto_estoque.sn_pendencia, 'N'),
                                       'E',
                                       'N',
                                       'P',
                                       'S')) OR
                       (NOT EXISTS
                        (SELECT 'X'
                            FROM dbamv.itmvto_ent ie
                           WHERE ie.cd_itmvto_estoque = ItMvto_Estoque.cd_itmvto_estoque) AND
                        'P' IN ('A', 'P')))
                   and dbamv.pkg_mges_emprestimo.retorna_tp_emprestimo_sai(ItMvto_Estoque.Cd_ItMvto_Estoque) IN
                       ('EC', 'PEC', 'PER')))
) rel, dbamv.est_pro ep, dbamv.localizacao l
where rel.cproduto = ep.cd_produto
and rel.cd_estoque = ep.cd_estoque
and ep.cd_localizacao = l.cd_localizacao(+)
and ep.cd_estoque = l.cd_estoque(+)
and rel.dt_emprestimo >= TRUNC(:WPA_DATA_INICIAL)
and rel.dt_emprestimo < TRUNC(:WPA_DATA_FINAL) + 1
Order by rel.ds_fornecedor