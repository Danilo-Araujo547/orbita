SELECT u.cd_unid_int AS CD_UNID_INT,
       u.ds_unid_int AS DS_UNID_INT,
       COUNT(*) AS QUANTIDADE,
       SYSDATE AS DATA
FROM dbamv.leito l
JOIN dbamv.unid_int u ON u.cd_unid_int = l.cd_unid_int
WHERE l.tp_situacao = 'A'
  AND l.sn_extra = 'N'
  AND l.tp_ocupacao IN ('O', 'V', 'R', 'L')
  AND u.cd_unid_int NOT IN (11, 12, 17)
GROUP BY u.cd_unid_int, u.ds_unid_int
ORDER BY u.ds_unid_int
