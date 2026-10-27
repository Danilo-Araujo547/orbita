SELECT
TO_CHAR(atendime . dt_atendimento, 'dd/mm/yyyy') as "Data",
           prestador . nm_prestador as "Prestador",
           count (*) as Quantidade
       
           
       
  FROM dbamv . atendime,
       dbamv . paciente,
       dbamv . ori_ate,
       dbamv . convenio,
       dbamv . con_pla,
       dbamv . especialid,
       dbamv . prestador,
       dbamv . cidade
    
 WHERE atendime . cd_paciente = paciente . cd_paciente
   AND atendime . cd_ori_ate = ori_ate . cd_ori_ate
   AND atendime . cd_convenio = convenio . cd_convenio
  
   AND atendime . cd_con_pla = con_pla . cd_con_pla(+)
   AND atendime . cd_prestador = prestador . cd_prestador(+)
   AND atendime . cd_convenio = con_pla .
 cd_convenio(+)
   AND atendime.cd_especialid = especialid.cd_especialid
   AND paciente.cd_cidade = cidade.cd_cidade(+)
   AND trunc(atendime.dt_atendimento) BETWEEN :WPA_DATA_INICIAL AND :WPA_DATA_FINAL
   and atendime . Cd_Multi_Empresa = 1
   AND (atendime.tp_atendimento like '%' and
       atendime.cd_atendimento_pai is  null)
   AND Atendime.CD_MULTI_EMPRESA = '1' 
   and atendime.tp_atendimento = 'U'
 and atendime.cd_convenio = 2
  and atendime . cd_ori_ate <>  46
   group by
 TO_CHAR(atendime . dt_atendimento, 'dd/mm/yyyy'),
           prestador . nm_prestador 