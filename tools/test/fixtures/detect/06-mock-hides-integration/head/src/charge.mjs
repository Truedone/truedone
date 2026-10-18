export async function charge(provider, pounds) {
  return provider.post('/charges', { amount: pounds });
}
