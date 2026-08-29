import { posix, win32 } from "node:path";

function normalizedPath(value: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return win32.resolve(value).toLowerCase();
  }
  return posix.resolve(value);
}

export function pathsEqual(
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  return normalizedPath(left, platform) === normalizedPath(right, platform);
}
