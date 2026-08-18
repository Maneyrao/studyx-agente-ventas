/**
 * Lógica pura del aprovisionamiento de precios de Stripe
 * (scripts/provision-stripe-prices.mjs). Sin I/O: nada de acá abre una
 * conexión a la base ni llama a la red de Stripe, así que se puede testear
 * con vitest sin mocks de infraestructura (salvo un `stripeClient` fake para
 * `upsertStripeProductAndPrice`).
 */

/**
 * Deriva el ambiente de Stripe a partir del prefijo de la clave secreta.
 * Nunca acepta ni devuelve la clave misma — sólo el ambiente.
 *
 * @param {string | undefined} secretKey
 * @returns {'test' | 'live'}
 */
export function deriveStripeEnvironment(secretKey) {
  const key = typeof secretKey === 'string' ? secretKey.trim() : '';
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test';
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live';
  throw new Error('STRIPE_SECRET_KEY_INVALID_PREFIX');
}

/**
 * Convierte el `price_amount` numeric(14,2) de un offering (string o number,
 * con exactamente dos decimales) al entero de centavos que espera
 * `Stripe.prices.create({ unit_amount })`.
 *
 * @param {string | number | null | undefined} amount
 * @returns {number}
 */
export function amountToUnitAmount(amount) {
  const str = typeof amount === 'number' ? amount.toFixed(2) : String(amount ?? '').trim();
  if (!/^\d+\.\d{2}$/.test(str)) {
    throw new Error(`INVALID_PRICE_AMOUNT:${amount}`);
  }
  const [whole, cents] = str.split('.');
  return Number(whole) * 100 + Number(cents);
}

/**
 * @param {{ code: string, id: string, display_name: string }} offering
 */
export function buildProductPayload(offering) {
  return {
    name: offering.display_name,
    metadata: {
      offering_code: offering.code,
      offering_id: offering.id,
    },
  };
}

/**
 * @param {{ code: string, price_amount: string | number, currency: string }} offering
 * @param {string} productId
 */
export function buildPricePayload(offering, productId) {
  return {
    product: productId,
    unit_amount: amountToUnitAmount(offering.price_amount),
    currency: offering.currency.toLowerCase(),
    metadata: { offering_code: offering.code },
  };
}

/**
 * Query de Stripe Search (`products.search`) que reencuentra el Product ya
 * creado para este offering por su `code`, sin depender de guardar el
 * product id en ningún otro lado. Es la clave estable que hace idempotente
 * la creación de Products entre corridas.
 *
 * @param {string} offeringCode
 */
export function productSearchQuery(offeringCode) {
  const escaped = String(offeringCode).replace(/(['\\])/g, '\\$1');
  return `metadata['offering_code']:'${escaped}'`;
}

/**
 * @param {Array<{ id: string, active: boolean, unit_amount: number, currency: string }>} prices
 * @param {number} unitAmount
 * @param {string} currency
 */
export function findMatchingPrice(prices, unitAmount, currency) {
  const lowerCurrency = currency.toLowerCase();
  return (
    prices.find(
      (price) => price.active && price.unit_amount === unitAmount && price.currency === lowerCurrency,
    ) ?? null
  );
}

/**
 * Encuentra o crea el Product y el Price de Stripe de un offering,
 * reencontrando lo ya creado antes de llamar a `create` para que correr esto
 * dos veces nunca duplique nada en Stripe.
 *
 * @param {{
 *   products: { search: Function, create: Function },
 *   prices: { list: Function, create: Function },
 * }} stripeClient
 * @param {{ id: string, code: string, display_name: string, price_amount: string | number, currency: string }} offering
 */
export async function upsertStripeProductAndPrice(stripeClient, offering) {
  const search = await stripeClient.products.search({
    query: productSearchQuery(offering.code),
    limit: 1,
  });
  const product = search.data[0] ?? (await stripeClient.products.create(buildProductPayload(offering)));

  const unitAmount = amountToUnitAmount(offering.price_amount);
  const priceList = await stripeClient.prices.list({ product: product.id, active: true, limit: 100 });
  const price =
    findMatchingPrice(priceList.data, unitAmount, offering.currency) ??
    (await stripeClient.prices.create(buildPricePayload(offering, product.id)));

  return { product, price };
}
