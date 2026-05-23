import type { Skill } from './types.js';

export const prdQuestionsSkill: Skill = {
  name: 'prd-questions',
  buildPrompt(params) {
    if (params.questionsFile) {
      return `Review the answered questions file at ${params.questionsFile} and generate follow-up questions based on the answers provided. Append them as a new "## Follow-up Questions" section.`;
    }
    if (!params.featureDescription) throw new Error('featureDescription or questionsFile is required for prd-questions');
    return `Generate clarifying questions for this feature: ${params.featureDescription}`;
  },
};
