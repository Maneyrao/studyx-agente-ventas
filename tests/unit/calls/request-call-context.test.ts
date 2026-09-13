import { describe, expect, it } from 'vitest';
import { deriveSharedLeadContext } from '@/features/calls/application/request-call';

describe('deriveSharedLeadContext', () => {
  it('hands Agent B the same known lead values and only the four missing shared fields', () => {
    expect(deriveSharedLeadContext({
      contactName: 'Ana Pérez',
      contactEmail: null,
      courseOfInterest: 'reparacion_celulares',
    })).toEqual({
      nombreLead: 'Ana Pérez',
      apellidoLead: 'Pérez',
      emailLead: '',
      courseOfInterest: 'reparacion_celulares',
      missingFields: ['mail'],
    });
  });

  it('marks a one-word identity as missing only its surname', () => {
    expect(deriveSharedLeadContext({
      contactName: 'Ana',
      contactEmail: 'ana@example.test',
      courseOfInterest: 'python',
    }).missingFields).toEqual(['apellido']);
  });
});
