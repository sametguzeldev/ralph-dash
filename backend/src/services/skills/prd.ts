import type { Skill } from './types.js';

export const prdSkill: Skill = {
  name: 'prd',
  buildPrompt(params) {
    if (!params.questionsFile) throw new Error('questionsFile is required for prd');
    return `Generate a PRD from the answered questions file at ${params.questionsFile}`;
  },
};
