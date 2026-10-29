/** A default build must be deliverable on its actual host. Explicit executable
 * requests keep their Windows verification requirement on every platform. */
export function defaultSoftwareTargets(platform: string = process.platform): ('zip' | 'exe')[] {
  return platform === 'win32' ? ['zip', 'exe'] : ['zip'];
}
