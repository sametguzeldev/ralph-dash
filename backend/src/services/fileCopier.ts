import fs from 'fs';
import path from 'path';

const SKILLS_TO_COPY = ['prd', 'prd-questions', 'ralph'];
const SCRIPTS_TO_COPY = ['ralph-cc.sh', 'CLAUDE.md'];

export function copyRalphFiles(ralphPath: string, projectRoot: string) {
  // Copy skills to {projectRoot}/.claude/skills/
  for (const skill of SKILLS_TO_COPY) {
    const src = path.join(ralphPath, 'skills', skill, 'SKILL.md');
    const dest = path.join(projectRoot, '.claude', 'skills', skill, 'SKILL.md');

    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  // Copy scripts to {projectRoot}/scripts/ralph/
  const scriptsDir = path.join(projectRoot, 'scripts', 'ralph');
  fs.mkdirSync(scriptsDir, { recursive: true });

  for (const file of SCRIPTS_TO_COPY) {
    const src = path.join(ralphPath, file);
    const dest = path.join(scriptsDir, file);

    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      // Make shell scripts executable
      if (file.endsWith('.sh')) {
        fs.chmodSync(dest, 0o755);
      }
    }
  }
}
