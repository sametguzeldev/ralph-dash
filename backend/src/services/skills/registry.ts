import { prdQuestionsSkill } from './prd-questions.js';
import { prdSkill } from './prd.js';
import { ralphSkill } from './ralph.js';
import type { Skill, SkillName } from './types.js';

const skills = new Map<SkillName, Skill>([
  [prdQuestionsSkill.name, prdQuestionsSkill],
  [prdSkill.name, prdSkill],
  [ralphSkill.name, ralphSkill],
]);

export function getSkill(name: string): Skill {
  const skill = skills.get(name as SkillName);
  if (!skill) {
    throw new Error(`Unknown skill: ${name}`);
  }
  return skill;
}

export type { Skill, SkillName, SkillParams } from './types.js';
