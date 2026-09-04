# Borrador para soporte de Vercel — no enviado

Se necesita autorización del usuario antes de contactar al proveedor. El mensaje contiene identificadores del proyecto y metadatos del incidente, sin valores de credenciales. Adjuntar únicamente el log sanitizado del intento, si soporte lo requiere; no adjuntar `.eval`, archivos de entorno, snapshots privados ni el repositorio completo.

---

Subject: Potential unintended private files in aborted CLI archive upload — request upload retention investigation

Hello Vercel Support,

Please investigate an aborted file upload to our account on September 4, 2026. Vercel CLI 58.9.4 with `--archive=tgz` recursively included descendants of directories that its dry-run file list reported as empty directory entries, despite our `.vercelignore` exclusions. Some descendants potentially contained private environment/configuration files.

Account: maneyrao
Team: `team_G25HixfcqzQ8ExR1GuKNEURb`
Project: `prj_Ns9LbXPT6UF6yvKR0rUcrwJAsFYM` (`studyx-agente-ventas`)
Approximate UTC window: September 4, 2026, 16:55–16:57. The upload log was created at 16:55:13.699368Z and last modified at 16:55:57.118586Z; these are local file times, not server receipts.
Client: Vercel CLI 58.9.4 / Node.js 25.9.0, macOS.

The CLI announced a 346.4 MB archive and last printed 86.6 MB progress before we terminated it. We cannot infer total bytes received from this progress output. We have no deployment ID, file hashes or HTTP upload acknowledgements for this attempt. The CLI implementation splits the archive into four logical `source.tgz.part*` files and uploads via `POST /v2/files`, potentially concurrently.

Please identify the upload requests in this window and confirm:

1. Which archive parts or partial payloads were accepted or retained, and their associated request IDs/digests if available.
2. Whether any deployment was created from them, and what access was possible to the uploaded data.
3. Retention and deletion status for these orphan uploads. Please remove any retained objects from this aborted attempt where supported and confirm the scope of removal.
4. Whether this archive behavior is a known CLI issue and its remediation.

A later, separate successful deployment, `dpl_4oQWvw17x2Pr6dVrXbW1qZ7adP4i`, was created at approximately 16:58 UTC from a clean export without `--archive`. Its file tree was inspected and excludes private directories. Please preserve that deployment and all previous valid deployments; this request concerns the aborted archive upload only.

We have retained a sanitized log and source-level analysis. We will not attach secrets or private configuration snapshots.

Thank you.
