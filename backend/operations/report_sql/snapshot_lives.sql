
select tp_contrato, sn_ativo, data_filtro, sum(total) total from (

SELECT DISTINCT TP_CONTRATO, Idade, TP_SEXO, NM_CIDADE, NM_UF, SN_ATIVO, DS_PLANO, CD_TIP_PLANO,
       DATA_FILTRO, CD_MATRICULA, TOTAL FROM (

--5
--ATIVOS SEM DESLIGAMENTO 

(SELECT DISTINCT C.TP_CONTRATO,
                       
              trunc(((:data_alvo - usu.DT_NASCIMENTO)/365),0) as IDADE,       
                USU.TP_SEXO,
                       
               
                USU.NM_CIDADE,
                USU.NM_UF,
                
                USU.SN_ATIVO,
                PLA.DS_PLANO,
                PLA.cd_tip_PLANO,
               :data_alvo DATA_FILTRO,USU.CD_MATRICULA,COUNT(*) total
               ,1 bloco
  FROM DBAPS.USUARIO         USU,
       DBAPS.CONTRATO        C,
       DBAPS.CONTRATO        CP,
       DBAPS.USUARIO         USUA,
       DBAPS.GRAU_PARENTESCO GP,
       DBAPS.PLANO           PLA,
       DBAPS.TIP_ACOMODACAO  TA
 WHERE USU.CD_CONTRATO = C.CD_CONTRATO
   AND C.CD_CONTRATO_TEM = CP.CD_CONTRATO(+)
   AND USU.CD_MATRICULA_TEM = USUA.CD_MATRICULA(+)
   AND USU.CD_PARENTESCO = GP.CD_PARENTESCO(+)
   AND USU.CD_PLANO = PLA.CD_PLANO
   AND PLA.CD_TIP_ACOMODACAO = TA.CD_TIP_ACOMODACAO
   AND TRUNC(USU.DT_CADASTRO) <= :data_alvo
   AND USU.CD_MATRICULA NOT IN (SELECT D.CD_MATRICULA FROM DBAPS.DESLIGAMENTO D)
   AND USU.SN_ATIVO = 'S'
   
   GROUP BY C.TP_CONTRATO,            
trunc(((:data_alvo - usu.DT_NASCIMENTO)/365),0),          
               
            
               USU.TP_SEXO,
                     
            
                USU.NM_CIDADE,
                USU.NM_UF,
               
                USU.SN_ATIVO,
                PLA.DS_PLANO, PLA.cd_tip_PLANO,USU.CD_MATRICULA
               
               
               
                )
   
UNION ALL --ATIVOS AT? A DATA

(SELECT DISTINCT C.TP_CONTRATO,
                       
              trunc(((:data_alvo - usu.DT_NASCIMENTO)/365),0) as IDADE,       
                USU.TP_SEXO,
                       
               
                USU.NM_CIDADE,
                USU.NM_UF,
                
                USU.SN_ATIVO,
                PLA.DS_PLANO,
                PLA.cd_tip_PLANO,
                :data_alvo DATA_FILTRO,USU.CD_MATRICULA,COUNT(*) total
               ,2 bloco
  FROM DBAPS.USUARIO         USU,
       DBAPS.CONTRATO        C,
       DBAPS.CONTRATO        CP,
       DBAPS.USUARIO         USUA,
       DBAPS.GRAU_PARENTESCO GP,
       DBAPS.PLANO           PLA,
       DBAPS.TIP_ACOMODACAO  TA
 WHERE USU.CD_CONTRATO = C.CD_CONTRATO
   AND C.CD_CONTRATO_TEM = CP.CD_CONTRATO(+)
   AND USU.CD_MATRICULA_TEM = USUA.CD_MATRICULA(+)
   AND USU.CD_PARENTESCO = GP.CD_PARENTESCO(+)
   AND USU.CD_PLANO = PLA.CD_PLANO
   AND PLA.CD_TIP_ACOMODACAO = TA.CD_TIP_ACOMODACAO
   AND TRUNC(USU.DT_CADASTRO) <= :data_alvo
   AND USU.CD_MATRICULA IN (SELECT D.CD_MATRICULA FROM DBAPS.DESLIGAMENTO D WHERE TRUNC(D.DT_DESLIGAMENTO) > :data_alvo) 
   GROUP BY C.TP_CONTRATO,            
trunc(((:data_alvo - usu.DT_NASCIMENTO)/365),0),          
               
            
               USU.TP_SEXO,
                     
            
                USU.NM_CIDADE,
                USU.NM_UF,
               
                USU.SN_ATIVO,
                PLA.DS_PLANO ,PLA.cd_tip_PLANO, USU.CD_MATRICULA
                )
   
   
   
UNION ALL --REATIVADOS AT? A DATA >
(
SELECT DISTINCT C.TP_CONTRATO,
                       
              trunc(((:data_alvo - usu.DT_NASCIMENTO)/365),0) as IDADE,       
                USU.TP_SEXO,
                       
               
                USU.NM_CIDADE,
                USU.NM_UF,
                
                USU.SN_ATIVO,
                PLA.DS_PLANO,
                PLA.cd_tip_PLANO,
                :data_alvo DATA_FILTRO,USU.CD_MATRICULA,COUNT(*) total
               ,3 bloco


  FROM DBAPS.USUARIO         USU,
       DBAPS.CONTRATO        C,
       DBAPS.CONTRATO        CP,
       DBAPS.USUARIO         USUA,
       DBAPS.GRAU_PARENTESCO GP,
       DBAPS.PLANO           PLA,
       DBAPS.TIP_ACOMODACAO  TA
 WHERE USU.CD_CONTRATO = C.CD_CONTRATO
   AND C.CD_CONTRATO_TEM = CP.CD_CONTRATO(+)
   AND USU.CD_MATRICULA_TEM = USUA.CD_MATRICULA(+)
   AND USU.CD_PARENTESCO = GP.CD_PARENTESCO(+)
   AND USU.CD_PLANO = PLA.CD_PLANO
   AND PLA.CD_TIP_ACOMODACAO = TA.CD_TIP_ACOMODACAO
   AND TRUNC(USU.DT_CADASTRO) <= :data_alvo
   AND USU.CD_MATRICULA IN (SELECT D.CD_MATRICULA FROM DBAPS.DESLIGAMENTO D WHERE TRUNC(D.DT_DESLIGAMENTO) <= :data_alvo
                            AND D.DT_REATIVACAO IS NOT NULL AND TRUNC(D.DT_REATIVACAO) <= :data_alvo
                            AND TRUNC(D.DT_REATIVACAO) > (SELECT MAX(TRUNC(DD.DT_DESLIGAMENTO)) FROM DBAPS.DESLIGAMENTO DD 
                                                          WHERE TRUNC(DD.DT_DESLIGAMENTO) <= :data_alvo AND DD.CD_MATRICULA = D.CD_MATRICULA)) 
   
                                               GROUP BY C.TP_CONTRATO,            
trunc(((:data_alvo - usu.DT_NASCIMENTO)/365),0),          
               
            
               USU.TP_SEXO,
                     
            
                USU.NM_CIDADE,
                USU.NM_UF,
               
                USU.SN_ATIVO,
                PLA.DS_PLANO
                ,PLA.cd_tip_PLANO,USU.CD_MATRICULA
                )     
UNION ALL --REATIVADOS AT? A DATA =
(SELECT DISTINCT C.TP_CONTRATO,
                       
              trunc(((:data_alvo - usu.DT_NASCIMENTO)/365),0) as IDADE,       
                USU.TP_SEXO,
                       
               
                USU.NM_CIDADE,
                USU.NM_UF,
                
                USU.SN_ATIVO,
                PLA.DS_PLANO,
                PLA.cd_tip_PLANO,
                :data_alvo DATA_FILTRO,USU.CD_MATRICULA,COUNT(*) total
               ,4 bloco

  FROM DBAPS.USUARIO         USU,
       DBAPS.CONTRATO        C,
       DBAPS.CONTRATO        CP,
       DBAPS.USUARIO         USUA,
       DBAPS.GRAU_PARENTESCO GP,
       DBAPS.PLANO           PLA,
       DBAPS.TIP_ACOMODACAO  TA
 WHERE USU.CD_CONTRATO = C.CD_CONTRATO
   AND C.CD_CONTRATO_TEM = CP.CD_CONTRATO(+)
   AND USU.CD_MATRICULA_TEM = USUA.CD_MATRICULA(+)
   AND USU.CD_PARENTESCO = GP.CD_PARENTESCO(+)
   AND USU.CD_PLANO = PLA.CD_PLANO
   AND PLA.CD_TIP_ACOMODACAO = TA.CD_TIP_ACOMODACAO
   AND TRUNC(USU.DT_CADASTRO) <= :data_alvo
   AND USU.CD_MATRICULA NOT IN (SELECT D.CD_MATRICULA FROM DBAPS.DESLIGAMENTO D WHERE TRUNC(D.DT_DESLIGAMENTO) <= :data_alvo
                                AND D.DT_REATIVACAO IS NULL  
                                AND TRUNC(D.DT_DESLIGAMENTO) >= (SELECT MAX(TRUNC(DD.DT_REATIVACAO)) FROM DBAPS.DESLIGAMENTO DD 
                                                                WHERE TRUNC(DD.DT_REATIVACAO) <= :data_alvo AND DD.CD_MATRICULA = D.CD_MATRICULA))      
   AND USU.CD_MATRICULA IN (SELECT D.CD_MATRICULA FROM DBAPS.DESLIGAMENTO D WHERE TRUNC(D.DT_DESLIGAMENTO) <= :data_alvo
                            AND D.DT_REATIVACAO IS NOT NULL AND TRUNC(D.DT_REATIVACAO) <= :data_alvo
                            AND TRUNC(D.DT_REATIVACAO) = (SELECT MAX(TRUNC(DD.DT_DESLIGAMENTO)) FROM DBAPS.DESLIGAMENTO DD 
                                                          WHERE TRUNC(DD.DT_DESLIGAMENTO) <= :data_alvo AND DD.CD_MATRICULA = D.CD_MATRICULA
                                                          AND DD.DT_REATIVACAO IS NOT NULL))                                                           
   
                                               GROUP BY C.TP_CONTRATO,            
trunc(((:data_alvo - usu.DT_NASCIMENTO)/365),0),          
               
            
               USU.TP_SEXO,
                     
            
                USU.NM_CIDADE,
                USU.NM_UF,
               
                USU.SN_ATIVO,
                PLA.DS_PLANO ,PLA.cd_tip_PLANO,USU.CD_MATRICULA
)

)
where cd_matricula not in (243110065,236180011,119000164,60270080,3950720008,3954380040,4027320068,363640029,246280000,102180172)
and cd_tip_plano in (1,2,3)
)
group by tp_contrato, sn_ativo, data_filtro
order by 3,1,2