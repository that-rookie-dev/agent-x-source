import type { QuestionnairePayload, QuestionnaireResponseState } from '@agentx/shared';
import { formatQuestionnaireAnswers } from '@agentx/shared';

/** Step through multi-question choice questionnaires on messaging channels. */
export class QuestionnaireWizard {
  private readonly answers: QuestionnaireResponseState = {};
  private questionIndex = 0;

  constructor(readonly payload: QuestionnairePayload) {}

  get currentIndex(): number {
    return this.questionIndex;
  }

  get currentQuestion() {
    return this.payload.questions[this.questionIndex];
  }

  get totalQuestions(): number {
    return this.payload.questions.length;
  }

  isComplete(): boolean {
    return this.questionIndex >= this.payload.questions.length;
  }

  recordSingleAnswer(value: string): void {
    const q = this.currentQuestion;
    if (!q) return;
    this.answers[q.id] = value;
    this.questionIndex += 1;
  }

  recordMultiAnswer(values: Set<string>): void {
    const q = this.currentQuestion;
    if (!q) return;
    this.answers[q.id] = values;
    this.questionIndex += 1;
  }

  formatFinalAnswer(): string | null {
    return formatQuestionnaireAnswers(this.payload, this.answers);
  }
}
