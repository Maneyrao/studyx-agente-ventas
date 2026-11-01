# Resumen offline

Tarifas Flash offpeak archivadas; costo estimado, no factura. No se recalifican criterios.

| Corrida | SHA | Aprobados | Llamadas | Tokens input/output/cache | Costo USD |
|---|---|---|---|---|---|
| focused-10d7b3e-flash-r1-20261101 | 10d7b3e5e7b5cdce3c88901cfedd3493346ecce2 | 10/22 | 43 | 385590/9092/190976 | 0.035220228 |
| focused-10d7b3e-flash-r2-20261101 | 10d7b3e5e7b5cdce3c88901cfedd3493346ecce2 | 10/22 | 46 | 447105/9870/246144 | 0.036804581999999995 |

| Corrida | Caso | Todos aprobados | Turnos aprobados | Rechazos ladder |
|---|---|---|---|---|
| focused-10d7b3e-flash-r1-20261101 | 03_single_course_recommendation | False | 1/2 | 0 |
| focused-10d7b3e-flash-r1-20261101 | 04_price_value_objection | True | 2/2 | 0 |
| focused-10d7b3e-flash-r1-20261101 | 06_repeated_price_bonus_ladder | False | 3/9 | 0 |
| focused-10d7b3e-flash-r1-20261101 | 07_think_it_over_not_closed | True | 2/2 | 0 |
| focused-10d7b3e-flash-r1-20261101 | 14_course_change_cancels_promotion | False | 2/7 | 0 |
| focused-10d7b3e-flash-r2-20261101 | 03_single_course_recommendation | False | 1/2 | 0 |
| focused-10d7b3e-flash-r2-20261101 | 04_price_value_objection | False | 1/2 | 0 |
| focused-10d7b3e-flash-r2-20261101 | 06_repeated_price_bonus_ladder | False | 3/9 | 0 |
| focused-10d7b3e-flash-r2-20261101 | 07_think_it_over_not_closed | True | 2/2 | 0 |
| focused-10d7b3e-flash-r2-20261101 | 14_course_change_cancels_promotion | False | 3/7 | 0 |

No regex or new semantic criteria. Promise/template/truncation flags rely only on explicit machine fields; otherwise unknown.

Se conserva la comparación exacta y la comparación que ignora sólo espacios. Otra comparación permite además eliminar únicamente ¿/¡ según autoridad:15. Se compara el último borrador con la entrega para separar reparación de cambio posterior. Una coincidencia técnica certifica preservación textual dentro de esas dos operaciones; no valida semántica. Los cambios detectados no se atribuyen a plantilla o recorte sin indicador estructural. Consulta por-turno.csv para texto autorizado, texto enviado, acciones, reparaciones y trazas.
