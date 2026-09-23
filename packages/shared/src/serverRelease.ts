const SERVER_RELEASE_REPOSITORY = "AllenReder/acode";
const SERVER_RELEASE_DEFAULT_BASE_URL = `https://github.com/${SERVER_RELEASE_REPOSITORY}/releases/download`;

export const SERVER_RELEASE_CHECKSUMS_FILE = "SHA256SUMS";
export const SERVER_RELEASE_PLATFORM_KEY = "linux-x64";

export function serverReleaseArchiveName(version: string): string {
  return `acode-server-${version}-${SERVER_RELEASE_PLATFORM_KEY}.tar.gz`;
}

/** Directory that `releases/download/<tag>/<asset>` lives under. */
export function serverReleaseDownloadBaseUrl(
  version: string,
  baseUrl: string | undefined = SERVER_RELEASE_DEFAULT_BASE_URL,
): string {
  return `${(baseUrl?.trim() || SERVER_RELEASE_DEFAULT_BASE_URL).replace(/\/+$/, "")}/v${version}`;
}
