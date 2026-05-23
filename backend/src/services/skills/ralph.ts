import type { Skill } from './types.js';

export const ralphSkill: Skill = {
  name: 'ralph',
  buildPrompt(params) {
    if (!params.prdFile) throw new Error('prdFile is required for ralph');
    return `Convert the PRD at ${params.prdFile} to prd.json format`;
  },
};
