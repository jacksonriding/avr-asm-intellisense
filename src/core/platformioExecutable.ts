import { posix, win32 } from "node:path";

export interface PlatformioExecutableSearch {
  readonly configuredPath: string;
  readonly customPath: string | undefined;
  readonly homeDirectory: string;
  readonly platform: NodeJS.Platform;
}

export function discoverPlatformioExecutable(
  search: PlatformioExecutableSearch,
  fileExists: (path: string) => boolean
): string {
  const configuredPath = search.configuredPath.trim();
  if (configuredPath.length > 0) {
    return configuredPath;
  }

  const windows = search.platform === "win32";
  const pathApi = windows ? win32 : posix;
  const executableName = windows ? "platformio.exe" : "platformio";
  const pathDelimiter = windows ? ";" : ":";
  if (search.customPath !== undefined) {
    for (const directory of search.customPath.split(pathDelimiter)) {
      const candidate = pathApi.join(directory, executableName);
      if (fileExists(candidate)) {
        return candidate;
      }
    }
  }

  const standardPath = windows
    ? pathApi.join(
        search.homeDirectory,
        ".platformio",
        "penv",
        "Scripts",
        executableName
      )
    : pathApi.join(search.homeDirectory, ".platformio", "penv", "bin", executableName);
  return fileExists(standardPath) ? standardPath : "pio";
}
