import { describe, expect, it } from 'vitest';
import { getSkill } from './registry.js';

describe('skills registry', () => {
  it('returns the registered skills by name', () => {
    expect(getSkill('prd-questions').name).toBe('prd-questions');
    expect(getSkill('prd').name).toBe('prd');
    expect(getSkill('ralph').name).toBe('ralph');
  });

  it('throws for an unknown skill', () => {
    expect(() => getSkill('unknown')).toThrow('Unknown skill: unknown');
  });
});

describe('skill prompt builders', () => {
  it('builds the initial PRD questions prompt', () => {
    expect(getSkill('prd-questions').buildPrompt({ featureDescription: 'Add team billing' })).toBe(
      'Generate clarifying questions for this feature: Add team billing',
    );
  });

  it('builds the follow-up PRD questions prompt', () => {
    expect(getSkill('prd-questions').buildPrompt({ questionsFile: 'tasks/questions.md' })).toBe(
      'Review the answered questions file at tasks/questions.md and generate follow-up questions based on the answers provided. Append them as a new "## Follow-up Questions" section.',
    );
  });

  it('requires either a feature description or questions file for PRD questions', () => {
    expect(() => getSkill('prd-questions').buildPrompt({})).toThrow(
      'featureDescription or questionsFile is required for prd-questions',
    );
  });

  it('builds the PRD prompt', () => {
    expect(getSkill('prd').buildPrompt({ questionsFile: 'tasks/questions.md' })).toBe(
      'Generate a PRD from the answered questions file at tasks/questions.md',
    );
  });

  it('requires a questions file for PRD generation', () => {
    expect(() => getSkill('prd').buildPrompt({})).toThrow('questionsFile is required for prd');
  });

  it('builds the Ralph prompt', () => {
    expect(getSkill('ralph').buildPrompt({ prdFile: 'tasks/prd.md' })).toBe(
      'Convert the PRD at tasks/prd.md to prd.json format',
    );
  });

  it('requires a PRD file for Ralph generation', () => {
    expect(() => getSkill('ralph').buildPrompt({})).toThrow('prdFile is required for ralph');
  });
});
