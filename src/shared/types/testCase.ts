export type MidsceneStep =
  | { type: 'ai'; instruction: string; name?: string }
  | { type: 'assert'; instruction: string; name?: string }
  | { type: 'sleep'; milliseconds: number; name?: string }
  | { type: 'unsupported'; key: string; line?: number; name?: string };

export interface ImportedTestCase {
  name: string;
  steps: MidsceneStep[];
  line?: number;
}

export interface ImportedTestSuite {
  pageUrl?: string;
  tasks: ImportedTestCase[];
}

export interface TestCaseParseResult {
  suite?: ImportedTestSuite;
  errors: string[];
}

export interface WebObservationElement {
  id: string;
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  placeholder?: string;
  testId?: string;
  ariaLabel?: string;
  selector: string;
  inputType?: string;
  options?: Array<{ label: string; value: string }>;
  value?: string;
  disabled?: boolean;
}

export interface WebFrameObservation {
  frameId: number;
  frameUrl: string;
  title: string;
  text: string;
  scrollY: number;
  scrollX: number;
  elements: WebObservationElement[];
}

export type BrowserAgentPlan =
  | { action: 'tap' | 'input'; elementId: string; value?: string; reason: string }
  | { action: 'scroll'; frameId: number; direction: 'up' | 'down' | 'left' | 'right'; distance: number; reason: string }
  | { action: 'finished'; reason: string }
  | { action: 'assertion'; passed: boolean; reason: string };

export interface BrowserAgentContext {
  instruction: string;
  observations: WebFrameObservation[];
  history: string[];
  mode: 'act' | 'assert';
}
