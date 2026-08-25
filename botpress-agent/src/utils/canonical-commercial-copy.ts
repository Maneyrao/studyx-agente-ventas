export interface CourseDurationCopyInput {
  readonly displayName: string
  readonly classes: number
}

export interface CoursePriceCopyInput {
  readonly displayName: string
  readonly currency: string
  readonly amount: string
}

export interface CourseModalityCopyInput {
  readonly displayName: string
  readonly modality: string
}

export interface UnknownCertificationCopyInput {
  readonly displayName: string
}

export interface CatalogOptionsCopyInput {
  readonly area: string
  readonly names: readonly string[]
  readonly maxItems: number
}

function renderDecimal(amount: string): string {
  return amount.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '')
}

export function renderCourseDuration(input: CourseDurationCopyInput): string {
  return `El curso de ${input.displayName} tiene ${input.classes} ${input.classes === 1 ? 'clase' : 'clases'}.`
}

export function renderCoursePrice(input: CoursePriceCopyInput): string {
  return `El precio de ${input.displayName} es ${input.currency} ${renderDecimal(input.amount)}.`
}

export function renderCourseModality(input: CourseModalityCopyInput): string {
  return `La modalidad de ${input.displayName} es ${input.modality}.`
}

export function renderUnknownCertification(input: UnknownCertificationCopyInput): string {
  return `La certificación de ${input.displayName} no está especificada en la información disponible.`
}

export function renderCatalogOptions(input: CatalogOptionsCopyInput): string {
  const names = input.names.slice(0, Math.max(0, input.maxItems))
  return `En ${input.area} tenemos ${names.join(', ')}. ¿Cuál querés revisar?`
}
