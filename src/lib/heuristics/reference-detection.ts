// Deterministic heuristic: detects whether a message refers to a past interaction.
// Normalized to lowercase without accents before matching (research D1).
// Extend MARKERS to add new patterns without changing the contract.

const MARKERS = [
  'como te dije',
  'como te habia dicho',
  'como te habia comentado',
  'lo que hablamos',
  'lo que conversamos',
  'lo que me dijiste',
  'lo que charlamos',
  'mi cuenta',
  'me ofreciste',
  'me dijiste',
  'me habias dicho',
  'me habias comentado',
  'el curso que',
  'la promo',
  'la promocion',
  'el descuento',
  'quedamos en',
  'habiamos quedado',
  'te pase',
  'te habia pasado',
  'mi pedido',
  'mi consulta anterior',
  'la ultima vez',
  'la vez pasada',
  'retomar',
  'volver a lo de',
  'seguir con lo de',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const NORMALIZED_MARKERS = MARKERS.map(normalize);

export function referencesPast(content: string): boolean {
  const normalized = normalize(content);
  return NORMALIZED_MARKERS.some((marker) => normalized.includes(marker));
}
