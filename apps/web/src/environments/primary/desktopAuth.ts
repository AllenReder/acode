let desktopBearerTokenPromise: Promise<string> | null = null;

export function readDesktopPrimaryBearerToken(): Promise<string | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  const bridge = window.desktopBridge;
  if (!bridge) {
    return Promise.resolve(null);
  }

  desktopBearerTokenPromise ??= bridge
    .getLocalEnvironmentBearerToken()
    .then((token) => {
      // An unauthenticated desktop can later be paired from the auth surface.
      // Do not permanently cache the empty pre-pairing result.
      if (token.length === 0) {
        desktopBearerTokenPromise = null;
      }
      return token;
    })
    .catch((error) => {
      desktopBearerTokenPromise = null;
      throw error;
    });
  return desktopBearerTokenPromise;
}

export function __resetDesktopPrimaryAuthForTests(): void {
  desktopBearerTokenPromise = null;
}
