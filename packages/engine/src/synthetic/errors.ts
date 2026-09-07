export class CapabilityError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'CapabilityError';
    this.code = code;
  }
}

export class CapabilityNotFoundError extends CapabilityError {
  constructor(id: string) {
    super(`Capability not found: ${id}`, 'NOT_FOUND');
    this.name = 'CapabilityNotFoundError';
  }
}

export class CapabilitySandboxError extends CapabilityError {
  constructor(message: string) {
    super(message, 'SANDBOX');
    this.name = 'CapabilitySandboxError';
  }
}

export class CapabilityGenerationError extends CapabilityError {
  constructor(message: string) {
    super(message, 'GENERATION');
    this.name = 'CapabilityGenerationError';
  }
}

export class CapabilityGraduationError extends CapabilityError {
  constructor(message: string) {
    super(message, 'GRADUATION');
    this.name = 'CapabilityGraduationError';
  }
}

export class CapabilityStoreError extends CapabilityError {
  constructor(message: string) {
    super(message, 'STORE');
    this.name = 'CapabilityStoreError';
  }
}

export class CapabilityValidationError extends CapabilityError {
  constructor(message: string) {
    super(message, 'VALIDATION');
    this.name = 'CapabilityValidationError';
  }
}
