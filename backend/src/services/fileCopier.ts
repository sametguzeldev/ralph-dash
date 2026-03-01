import fs from 'fs';
import path from 'path';
import { getProvider, DEFAULT_PROVIDER } from '../providers/registry.js';

export function copyRalphFiles(ralphPath: string, projectRoot: string, providerName: string = DEFAULT_PROVIDER) {
  const provider = getProvider(providerName);
  const filesToSync = provider.getFilesToSync(ralphPath);

  for (const file of filesToSync) {
    const src = file.source;
    const dest = path.join(projectRoot, file.dest);

    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      // Make shell scripts executable
      if (dest.endsWith('.sh')) {
        fs.chmodSync(dest, 0o755);
      }
    }
  }
}
