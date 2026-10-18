export async function charge(provider, pounds) {
  return provider.post('/payments', { amount_cents: pounds * 100 });
}
