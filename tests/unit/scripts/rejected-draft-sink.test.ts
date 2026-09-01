import { readFileSync, rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  redactIntakePiiV1,
  writeRejectedDraftV1,
} from '../../../scripts/lib/rejected-draft-sink';

const intake = {
  nombre: 'Ana',
  apellido: 'Pérez',
  correo: 'ana.perez@example.com',
  telefono: '+15551234567',
};

describe('sumidero de borradores rechazados', () => {
  it('redacta los cuatro campos del intake', () => {
    const redacted = redactIntakePiiV1(
      'Hola Ana Pérez, te escribo a ana.perez@example.com o al +15551234567.',
      intake,
    );
    for (const value of Object.values(intake)) {
      expect(redacted).not.toContain(value);
    }
  });

  it('redacta también un correo o un teléfono que el modelo inventó', () => {
    // La pasada por valor no alcanza: un dato que el modelo alucinó no está
    // en `intake` y se escaparía.
    const redacted = redactIntakePiiV1('Escribime a otro@example.org o al +5491122334455.', intake);
    expect(redacted).not.toContain('otro@example.org');
    expect(redacted).not.toContain('5491122334455');
  });

  it('no escribe PII ni siquiera cuando el borrador la contiene', () => {
    const sink = 'artifacts/rejected-drafts/test-drafts.jsonl';
    rmSync(sink, { force: true });
    writeRejectedDraftV1({
      rejection_id: '00000000-0000-4000-8000-000000000001',
      codes: ['FACT_NOT_AUTHORIZED'],
      subjects: ['payment:x:monthly_6:price:v1'],
      authorized_fact_ids: ['offering:x:name:v1'],
      draft_text: 'Ana Pérez, ana.perez@example.com, el precio es USD 999.',
      repair_level: 'N2',
    }, intake, sink);

    const written = readFileSync(sink, 'utf8');
    for (const value of Object.values(intake)) {
      expect(written).not.toContain(value);
    }
    // Lo que sí conserva es lo que sirve para diagnosticar.
    expect(written).toContain('FACT_NOT_AUTHORIZED');
    expect(written).toContain('USD 999');
    rmSync(sink, { force: true });
  });

  it('el sumidero está gitignored', () => {
    const gitignore = readFileSync('.gitignore', 'utf8');
    expect(gitignore).toMatch(/artifacts\/rejected-drafts/u);
  });

  it('un valor de un solo carácter no se redacta: borraría medio texto', () => {
    const redacted = redactIntakePiiV1('El plan es a 6 cuotas.', { nombre: 'a' });
    expect(redacted).toBe('El plan es a 6 cuotas.');
  });
});
