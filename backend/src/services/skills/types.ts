export type SkillName = 'prd-questions' | 'prd' | 'ralph';

export interface SkillParams {
  featureDescription?: string;
  questionsFile?: string;
  prdFile?: string;
}

export interface Skill {
  name: SkillName;
  buildPrompt(params: SkillParams): string;
}
