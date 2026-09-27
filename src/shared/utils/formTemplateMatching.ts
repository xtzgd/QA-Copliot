import { FormFieldItem, FormFillTemplateFieldRule } from '../types/formFill';

/** Match stable names before labels; refuse ambiguous candidates. */
export function matchTemplateField(rule: FormFillTemplateFieldRule, fields: FormFieldItem[], used = new Set<string>()): FormFieldItem | undefined {
  const normalize = (text: string) => text.replace(/\s+/g, '').toLowerCase();
  const label = normalize(rule.labelPattern);
  const candidates = fields.filter(f => !used.has(f.fieldId) && !f.disabled && !f.readOnly && f.kind !== 'unsupported' && (!rule.kind || f.kind === rule.kind));
  const named = rule.fieldName ? candidates.filter(f => f.name === rule.fieldName) : [];
  if (named.length === 1) return named[0];
  const exact = (named.length ? named : candidates).filter(f => label && normalize(f.label) === label);
  if (exact.length) return exact.length === 1 ? exact[0] : undefined;
  if (named.length) return undefined;
  const fuzzy = candidates.filter(f => {
    const other = normalize(f.label);
    return label.length >= 2 && other.length >= 2 && (other.includes(label) || label.includes(other));
  });
  return fuzzy.length === 1 ? fuzzy[0] : undefined;
}
