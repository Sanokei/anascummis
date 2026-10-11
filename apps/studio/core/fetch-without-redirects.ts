/**
 * Public research sources must answer at the requested URL.
 * Workers rejects redirect: 'error'; manual mode enforces the same zero-hop policy.
 * Never resolve Location or forward request headers to a redirect destination.
 */
export async function fetchWithoutRedirects(url: URL, init: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    // Release the unread upstream body without hiding the redirect rejection.
    await response.body?.cancel().catch(() => {});
    throw new Error('Research source redirected; redirects are not allowed.');
  }
  return response;
}
