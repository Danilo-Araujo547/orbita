select estoque, produto, qtde, valor_unit, valor_total  from sigsaudej.vdic_mega_relatorios_003 vr3
where vr3.Ano = :WPA_DATA_INICIAL and vr3.Mes = :WPA_DATA_FINAL
order by 1, 2
