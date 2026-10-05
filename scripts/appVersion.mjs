// One source of truth for "which version of the app is this build".
//
// The app compares the version baked into its code with the one in /version.json to decide whether to show
// "Update Available". Those two used to be set by hand in two different places (VITE_APP_VERSION and
// public/version.json); if they ever differed, every visitor got a popup that no refresh could clear, on top of
// the login screen. Both now come from the value returned here, in the same build.

/**
 * @param {{ explicit?: string, pkgVersion: string, commit?: string, builtAt: Date }} input
 *   explicit  VITE_APP_VERSION when someone sets it on purpose (wins, so releases can still be named by hand)
 *   commit    short git hash of the build, when available
 */
export function resolveAppVersion({ explicit, pkgVersion, commit, builtAt }) {
  const chosen = (explicit || '').trim();
  if (chosen) return chosen;
  const stamp = builtAt.toISOString().slice(0, 16).replace(/[-:T]/g, ''); // 202610051530
  return `${pkgVersion}+${(commit || '').trim() || stamp}`;
}

/** The contents of version.json for a build. */
export function versionFile(version, builtAt) {
  return {
    version,
    buildDate: builtAt.toISOString(),
    forceUpdate: false,
    message: 'New update available. Please refresh.',
    updateUrl: '/',
  };
}
