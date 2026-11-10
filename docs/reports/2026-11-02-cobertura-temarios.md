# Cobertura de temarios — 2026-11-02

Reporte de sólo lectura (PASO 1d). No se cargó nada.

**Fuente:** base local de pruebas `studyx_test` en 127.0.0.1:55434, workspace `studyx`, sembrada con
`supabase/seed/studyx-manual.sql`, `studyx-temarios.sql` y `studyx-programas.sql`. El catálogo remoto del entorno de
pruebas no se consultó, porque no hay acceso de lectura a sus credenciales desde esta sesión. Si el remoto tiene más
cursos activos que los 40 sembrados, conviene repetir la consulta allí.

**Criterio:** "con temario oficial" = tiene al menos un `knowledge_sources` activo, `source_type='offering'`, con
`metadata.source='official_program_pdf'` y `metadata.course_code` igual al código del curso activo. Es la misma
vinculación que usa `searchByOfferingCode` (`src/features/orchestration/adapters/postgres-retrievers.ts:144`).

## Resumen

| | Cursos activos |
|---|---|
| Total | 40 |
| Con temario oficial vinculado | 16 |
| Sólo descripción del manual (`studyx_manual_1`), sin temario | 24 |

## Con temario oficial (16)

Decoración de Interiores, Diseño Gráfico con Corel Draw, Diseño Gráfico con Illustrator, Diseño Gráfico con Photoshop,
Energía Solar Fotovoltaica, Entrenamiento Funcional, Fotografía Profesional, Maquillaje Profesional, Marketing Digital,
Nutrición y Alimentación Saludable, Organizador Profesional de Eventos Sociales, Paisajismo y Jardinería, Publicidad en
Redes Sociales, Sushi para Principiantes, Uñas Gelificadas, Introducción al Vino, la Cata y el Maridaje.

## Sin temario oficial (24)

Instalación de Aires Acondicionados, Armado y Reparación de PC, AutoCAD orientado al Diseño de Interiores, Instalación y
Configuración de Cámaras de Seguridad, Coaching y Liderazgo, Community Manager, Comunicación Interna en Empresas,
Especialista en Marketing, Especialista en Ventas, Estrategias para Emprender, Excel Integral, Fotografía con Celulares
para Tiendas Online, Influencers y Creadores de Contenidos, Inglés 1, Inglés 2, Inglés 3, Instagram para Emprendedores,
Introducción al Catering, Introducción a las Criptomonedas, **Introducción al Ecommerce**, Oratoria, Organización de Baby
Shower, Redes Informáticas, Reparación de Celulares.

Consecuencia para hoy: en el turno "ecommerce", el modelo puede recibir nombre, duración (8 clases), modalidad y
descripción del manual, pero no un temario. Cualquier contenido de clases que nombre fuera de esos hechos lo va a
rechazar el control de hechos.

## Temarios oficiales sin curso activo

Hay PDF oficiales vinculados a códigos que no están activos en el catálogo: `barista`, `cuidador_adultos_mayores`,
`depilacion_definitiva`, `estetica_integral`, `masoterapia`. `programas-studyx-pdf.json` trae 28 programas y hay
temario vinculado para 21 códigos distintos: 16 activos y 5 inactivos o ausentes.
