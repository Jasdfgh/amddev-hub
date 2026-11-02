// No imports so the same reviewed source can be embedded in the Makers function.
export function makeSigner(protocol) {
  return ({ env, ...request }) => protocol.signProxyRequest({
    ...request, keyId: env?.HUB_PROXY_KEY_ID, key: env?.HUB_PROXY_KEY,
  });
}
