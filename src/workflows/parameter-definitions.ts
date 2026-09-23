import {parse, parseAllDocuments} from 'yaml';

export const PARAMETER_DEFINITIONS_SCHEMA_VERSION = 1 as const;

export type WorkflowParameterKind = 'file' | 'text' | 'choice' | 'integer' | 'fixed';

export type WorkflowParameterOption = {
  value: string;
  label: string;
};

export type WorkflowParameterCondition = {parameter: string; equals: string | string[]};

export type WorkflowParameterDefinition = {
  id: string;
  label: string;
  section: string;
  kind: WorkflowParameterKind;
  required: boolean;
  hidden: boolean;
  default: string | null;
  placeholder?: string;
  preview?: string;
  options?: WorkflowParameterOption[];
  visible_when?: WorkflowParameterCondition;
  // Only meaningful for kind 'file': when the referenced parameter's value matches, this field
  // has no directly typable value and is set exclusively through the file chooser (see the
  // 'reference-source'/'target-source' local-path-choose option in annotation-transfer).
  browse_only_when?: WorkflowParameterCondition;
};

export type ParameterDefinitionValidationIssue = {
  path: string;
  message: string;
};

export class ParameterDefinitionsValidationError extends Error {
  readonly issues: readonly ParameterDefinitionValidationIssue[];

  constructor(issues: ParameterDefinitionValidationIssue[]) {
    super(
      `Invalid workflow parameter definitions:\n${issues
        .map(issue => `- ${issue.path}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'ParameterDefinitionsValidationError';
    this.issues = issues;
  }
}

type RecordValue = Record<string, unknown>;
const identifierPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const parameterKinds: readonly WorkflowParameterKind[] = [
  'file',
  'text',
  'choice',
  'integer',
  'fixed',
];

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(
  value: RecordValue,
  allowed: readonly string[],
  path: string,
  issues: ParameterDefinitionValidationIssue[],
): void {
  const allowedFields = new Set(allowed);
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      issues.push({path: `${path}.${field}`, message: 'unknown field'});
    }
  }
}

function nonEmptyString(
  value: unknown,
  path: string,
  issues: ParameterDefinitionValidationIssue[],
): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({path, message: 'must be a non-empty string'});
    return false;
  }
  return true;
}

function validateEquals(
  value: unknown,
  path: string,
  issues: ParameterDefinitionValidationIssue[],
): string | string[] | undefined {
  if (typeof value === 'string') {
    return nonEmptyString(value, path, issues) ? value : undefined;
  }
  if (Array.isArray(value) && value.length > 0) {
    const values: string[] = [];
    let valid = true;
    value.forEach((entry, index) => {
      if (nonEmptyString(entry, `${path}[${index}]`, issues)) {
        values.push(entry);
      } else {
        valid = false;
      }
    });
    return valid ? values : undefined;
  }
  issues.push({path, message: 'must be a non-empty string or a non-empty array of non-empty strings'});
  return undefined;
}

function validateCondition(
  value: unknown,
  path: string,
  issues: ParameterDefinitionValidationIssue[],
): WorkflowParameterCondition | undefined {
  if (!isRecord(value)) {
    issues.push({path, message: 'must be an object'});
    return undefined;
  }
  rejectUnknownFields(value, ['parameter', 'equals'], path, issues);
  const validParameter = nonEmptyString(value.parameter, `${path}.parameter`, issues);
  const equals = validateEquals(value.equals, `${path}.equals`, issues);
  return validParameter && equals !== undefined
    ? {parameter: value.parameter as string, equals}
    : undefined;
}

export function validateParameterDefinitions(value: unknown): WorkflowParameterDefinition[] {
  const issues: ParameterDefinitionValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new ParameterDefinitionsValidationError([{path: '$', message: 'must be an object'}]);
  }
  rejectUnknownFields(value, ['schema_version', 'parameters'], '$', issues);
  if (value.schema_version !== PARAMETER_DEFINITIONS_SCHEMA_VERSION) {
    issues.push({
      path: '$.schema_version',
      message: `must equal supported version ${PARAMETER_DEFINITIONS_SCHEMA_VERSION}`,
    });
  }
  if (!Array.isArray(value.parameters)) {
    issues.push({path: '$.parameters', message: 'must be an array'});
  }

  const definitions: WorkflowParameterDefinition[] = [];
  const ids = new Set<string>();
  if (Array.isArray(value.parameters)) {
    value.parameters.forEach((candidate, index) => {
      const path = `$.parameters[${index}]`;
      if (!isRecord(candidate)) {
        issues.push({path, message: 'must be an object'});
        return;
      }
      rejectUnknownFields(
        candidate,
        [
          'id',
          'label',
          'section',
          'kind',
          'required',
          'hidden',
          'default',
          'placeholder',
          'preview',
          'options',
          'visible_when',
          'browse_only_when',
        ],
        path,
        issues,
      );
      const id = candidate.id;
      const label = candidate.label;
      const section = candidate.section;
      const kind = candidate.kind;
      const required = candidate.required;
      const hidden = candidate.hidden;
      const defaultValue = candidate.default;
      const validId = nonEmptyString(id, `${path}.id`, issues);
      if (validId && !identifierPattern.test(id)) {
        issues.push({path: `${path}.id`, message: 'must be a lowercase hyphenated identifier'});
      }
      const validLabel = nonEmptyString(label, `${path}.label`, issues);
      const validSection = nonEmptyString(section, `${path}.section`, issues);
      const validKind =
        typeof kind === 'string' && parameterKinds.includes(kind as WorkflowParameterKind);
      if (!validKind) {
        issues.push({path: `${path}.kind`, message: `must be one of: ${parameterKinds.join(', ')}`});
      }
      if (typeof required !== 'boolean') {
        issues.push({path: `${path}.required`, message: 'must be a boolean'});
      }
      if ('hidden' in candidate && typeof hidden !== 'boolean') {
        issues.push({path: `${path}.hidden`, message: 'must be a boolean'});
      }
      for (const optionalText of ['placeholder', 'preview'] as const) {
        if (optionalText in candidate) {
          nonEmptyString(candidate[optionalText], `${path}.${optionalText}`, issues);
        }
      }
      let visibleWhen: WorkflowParameterDefinition['visible_when'];
      if ('visible_when' in candidate) {
        visibleWhen = validateCondition(candidate.visible_when, `${path}.visible_when`, issues);
      }
      let browseOnlyWhen: WorkflowParameterDefinition['browse_only_when'];
      if ('browse_only_when' in candidate) {
        if (kind !== 'file') {
          issues.push({
            path: `${path}.browse_only_when`,
            message: 'is only allowed for a file field',
          });
        } else {
          browseOnlyWhen = validateCondition(
            candidate.browse_only_when,
            `${path}.browse_only_when`,
            issues,
          );
        }
      }
      let options: WorkflowParameterOption[] | undefined;
      if (kind === 'choice') {
        if (!Array.isArray(candidate.options) || candidate.options.length === 0) {
          issues.push({path: `${path}.options`, message: 'must be a non-empty array for a choice'});
        } else {
          options = [];
          const optionValues = new Set<string>();
          candidate.options.forEach((option, optionIndex) => {
            const optionPath = `${path}.options[${optionIndex}]`;
            if (!isRecord(option)) {
              issues.push({path: optionPath, message: 'must be an object'});
              return;
            }
            rejectUnknownFields(option, ['value', 'label'], optionPath, issues);
            const optionValue = option.value;
            const optionLabel = option.label;
            const validOptionValue = nonEmptyString(optionValue, `${optionPath}.value`, issues);
            const validOptionLabel = nonEmptyString(optionLabel, `${optionPath}.label`, issues);
            if (validOptionValue && optionValues.has(optionValue)) {
              issues.push({path: `${optionPath}.value`, message: `duplicate option '${optionValue}'`});
            } else if (validOptionValue) {
              optionValues.add(optionValue);
            }
            if (validOptionValue && validOptionLabel) {
              options?.push({value: optionValue, label: optionLabel});
            }
          });
        }
      } else if ('options' in candidate) {
        issues.push({path: `${path}.options`, message: 'is only allowed for a choice'});
      }
      if (!('default' in candidate)) {
        issues.push({path: `${path}.default`, message: 'is required'});
      } else if (
        defaultValue !== null &&
        (typeof defaultValue !== 'string' || defaultValue.trim().length === 0)
      ) {
        issues.push({path: `${path}.default`, message: 'must be null or a non-empty string'});
      }
      if (
        kind === 'choice' &&
        typeof defaultValue === 'string' &&
        options &&
        !options.some(option => option.value === defaultValue)
      ) {
        issues.push({path: `${path}.default`, message: 'must match a declared choice option'});
      }

      if (validId) {
        if (ids.has(id)) {
          issues.push({path: `${path}.id`, message: `duplicate parameter ID '${id}'`});
        } else {
          ids.add(id);
        }
      }

      if (
        validId &&
        identifierPattern.test(id) &&
        validLabel &&
        validSection &&
        validKind &&
        typeof required === 'boolean' &&
        (hidden === undefined || typeof hidden === 'boolean') &&
        'default' in candidate &&
        (defaultValue === null ||
          (typeof defaultValue === 'string' && defaultValue.trim().length > 0))
      ) {
        definitions.push({
          id,
          label,
          section,
          kind: kind as WorkflowParameterKind,
          required,
          hidden: hidden === true,
          default: defaultValue,
          ...('placeholder' in candidate ? {placeholder: candidate.placeholder as string} : {}),
          ...('preview' in candidate ? {preview: candidate.preview as string} : {}),
          ...(options ? {options} : {}),
          ...(visibleWhen ? {visible_when: visibleWhen} : {}),
          ...(browseOnlyWhen ? {browse_only_when: browseOnlyWhen} : {}),
        });
      }
    });
  }

  const definitionIds = new Set(definitions.map(definition => definition.id));
  definitions.forEach((definition, index) => {
    if (definition.visible_when && !definitionIds.has(definition.visible_when.parameter)) {
      issues.push({
        path: `$.parameters[${index}].visible_when.parameter`,
        message: `references unknown parameter '${definition.visible_when.parameter}'`,
      });
    }
    if (definition.browse_only_when && !definitionIds.has(definition.browse_only_when.parameter)) {
      issues.push({
        path: `$.parameters[${index}].browse_only_when.parameter`,
        message: `references unknown parameter '${definition.browse_only_when.parameter}'`,
      });
    }
  });

  if (issues.length > 0) {
    throw new ParameterDefinitionsValidationError(issues);
  }
  return definitions;
}

export function parseParameterDefinitions(source: string): WorkflowParameterDefinition[] {
  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ParameterDefinitionsValidationError([
      {path: '$', message: `is not valid YAML: ${detail}`},
    ]);
  }
  return validateParameterDefinitions(value);
}
