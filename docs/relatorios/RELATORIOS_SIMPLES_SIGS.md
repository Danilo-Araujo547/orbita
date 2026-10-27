# Relatórios simples Oracle SIGS — mapeamento

Data: 25/10/2026. Unidade SCV. Registros existentes preservados; não duplicar cadastros. Queries recuperadas do catálogo WhatsReport .123 de 24/10/2026 e convertidas para binds tipados.

| Código | Relatório | View | Parâmetros |
|---|---|---|---|
| legacy123-265 | Consultas por unidade, CBO e equipe | SIGSAUDEJ.VDIC_MEGA_RELATORIOS_001 | Data inicial e final |
| legacy123-272 | Consultas por procedimento | SIGSAUDEJ.VDIC_MEGA_RELATORIOS_001 | Data inicial e final |
| legacy123-289 | Saída de medicamentos | SIGSAUDEJ.VDIC_MEGA_RELATORIOS_003 | Ano e mês (inteiros) |
| legacy123-291 | Gestantes por unidade | SIGSAUDEJ.VDIC_MEGA_RELATORIOS_004 | Nenhum |
| legacy123-312 | Exames regulados UPA/PA | SIGSAUDEJ.VDIC_MEGA_RELATORIOS_011 | Data inicial e final |

## Configuração no SCV

- Fonte SQL direta; conexão existente Legado 17 · Oracle SIGS · prdpmv; mesma unidade. Nenhuma senha foi criada, transferida ou alterada.
- Formato PDF, pronto para utilizar o renderizador tabular existente após validação da fonte. Não são necessários gráficos, imagens, planilhas externas ou snapshots no SQL cadastrado. A lógica interna das views ainda não foi inspecionada.
- Relatórios permanecem desativados e não revisados. Validar conexão, views, permissões da conta, amostras e resultados antes da habilitação. Não confundir mapeamento com homologação de dados.
- Nenhuma programação, permissão de destinatário ou histórico é alterado. O cadastro anterior e os parâmetros legados ficam preservados em legacy.sigs_mapping.previous_definition.
- Os IDs 265 e 272 compartilham a view 001: agrupam, respectivamente, por unidade/CBO/equipe e unidade/procedimento.
- O 289 filtra ANO e MES. Os nomes internos WPA_DATA_INICIAL/WPA_DATA_FINAL foram preservados para compatibilidade; agora são parâmetros inteiros com prompts de ano e mês, conforme máscaras originais YYYY/MM. Validação operacional dos valores deve incluir mês de 1 a 12.
- O 291 lista gestantes por unidade, com datas e classificações provenientes da view, sem interpretação clínica e sem parâmetros.
- O 312 mantém o filtro de unidades 107-1/105-1 e exige OBS preenchida.
- Nos relatórios por período, o limite superior usa data final + 1, exclusivo, para incluir o dia final inteiro. Alteração intencional em relação ao BETWEEN literal; conferir a equivalência no período de homologação.

## Queries recuperadas

### legacy123-265 — Consultas por unidade, CBO e equipe

Arquivo: backend/operations/report_sql/sigs/consultations.sql

```sql
select UNIDADE_SOLICITANTE, vr.cbo, EQUI_NOME_REFERENCIA
AS EQUIPE, count(distinct vr.cd_agendamento)  AS QUANTIDADE 
from sigsaudej.vdic_mega_relatorios_001 vr

where vr.dt_atendimento >= :WPA_DATA_INICIAL AND vr.dt_atendimento < :WPA_DATA_FINAL + 1
GROUP BY UNIDADE_SOLICITANTE, CBO, EQUI_NOME_REFERENCIA 
ORDER BY UNIDADE_SOLICITANTE, 4 DESC
```

### legacy123-272 — Consultas por procedimento

Arquivo: backend/operations/report_sql/sigs/consultation_procedures.sql

```sql
select UNIDADE_SOLICITANTE, vr.procedimento,  count(distinct vr.cd_agendamento)  AS QUANTIDADE 
from sigsaudej.vdic_mega_relatorios_001 vr
where vr.dt_atendimento >= :WPA_DATA_INICIAL AND vr.dt_atendimento < :WPA_DATA_FINAL + 1 GROUP BY UNIDADE_SOLICITANTE, vr.procedimento ORDER BY UNIDADE_SOLICITANTE, 3 DESC
```

### legacy123-289 — Saída de medicamentos

Arquivo: backend/operations/report_sql/sigs/medication_outputs.sql

```sql
select estoque, produto, qtde, valor_unit, valor_total  from sigsaudej.vdic_mega_relatorios_003 vr3
where vr3.Ano = :WPA_DATA_INICIAL and vr3.Mes = :WPA_DATA_FINAL
order by 1, 2
```

### legacy123-291 — Gestantes por unidade

Arquivo: backend/operations/report_sql/sigs/pregnancies.sql

```sql
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
```

### legacy123-312 — Exames regulados UPA/PA

Arquivo: backend/operations/report_sql/sigs/regulated_exams.sql

```sql
select vr11.unidade,
       vr11.data,
       vr11.profissional,       
       vr11.procedimento,
       vr11.obs,
       vr11.cd_paciente || '-' ||  vr11.paciente as paciente
from sigsaudej.vdic_mega_relatorios_011 vr11
where vr11.unsa_cod in ('107-1','105-1')
and vr11.data >= :WPA_DATA_INICIAL AND vr11.data < :WPA_DATA_FINAL + 1
and vr11.obs is not null
order by 1, 2, 3
```

## Operação e evidências

Cadastro idempotente: python manage.py map_sigs_reports --unit scv --actor admin. Queries personalizadas, relatórios ativos ou layouts Canvas existentes impedem sobrescrita automática. A atualização é atômica e auditada.

Evidências e backup: /opt/backups/orbita/sigs-mapping-20261025/. Testes em PostgreSQL validam binds, tipos, auditoria de parâmetros, preservação de permissões, idempotência e ausência de chamadas a banco externo/transportes durante o cadastro.


## Atualização — 25/10/2026

Cinco relatórios validados ao vivo no Oracle e integrados ao Canvas, ainda desativados. Ver `VALIDACAO_SIGS.md` para períodos, totais, semântica real das views e limites.
