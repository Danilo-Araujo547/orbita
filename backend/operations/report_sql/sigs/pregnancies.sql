select unidade_referencia as UNIDADE_REF, 
nm_gestante AS NOME_GESTANTE, 
dt_dum AS DATA_ULT_MENSTRUACAO, 
dt_dpp AS DATA_PARTO, 
ds_tipo_gravidez AS TP_GRAVIDEZ, 
ds_status_tb_gestante AS STATUS,
ds_status_tb_sisprenatal AS STATUS_PRENATAL,
CASE ds_risco_gravidez
 WHEN 1 THEN 'RISCO HABITUAL'
 WHEN 2 THEN 'RISCO INTERMEDIÁRIO'
 WHEN 3 THEN 'ALTO RISCO'
 ELSE NULL
END AS RISCO  
from sigsaudej.vdic_mega_relatorios_004 vr4
order by 1, 2
