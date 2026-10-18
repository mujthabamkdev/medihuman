export const RULE_BASED_SUMMARY_DISCLAIMER =
  'Rule-based record summary, not AI, diagnosis, medical advice, or a replacement for a clinician or pharmacist.';
export const AI_SUMMARY_DISCLAIMER =
  'AI-assisted draft for clinician review. Not diagnosis, medical advice, or a treatment recommendation.';

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function latestReconciliation(reconciliations) {
  return [...reconciliations].sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0];
}

/**
 * Deliberately small, inspectable adapter seam. A future approved adapter can
 * be passed to buildSummary without changing the endpoint's input contract.
 */
export function buildRuleBasedSummary({ profile = {}, medicines = [], prescriptions = [], reconciliations = [] } = {}) {
  const findings = [];
  if (profile.allergies) findings.push({ type: 'profile', severity: 'info', message: 'Allergy information is recorded in the patient profile.' });
  if (profile.conditions) findings.push({ type: 'profile', severity: 'info', message: 'Condition context is recorded in the patient profile for clinician review.' });
  findings.push({ type: 'medicines', severity: 'info', message: `${countLabel(medicines.length, 'medicine')} recorded.` });
  findings.push({ type: 'prescriptions', severity: 'info', message: `${countLabel(prescriptions.length, 'prescription')} recorded.` });

  const latest = latestReconciliation(reconciliations);
  if (!latest) {
    findings.push({ type: 'reconciliation', severity: 'info', message: 'No medicine reconciliation is recorded.' });
  } else if (latest.isExactMatch) {
    findings.push({ type: 'reconciliation', severity: 'info', message: 'Latest recorded reconciliation is marked as an exact match.' });
  } else {
    findings.push({
      type: 'reconciliation',
      severity: 'review',
      message: `Latest recorded reconciliation lists ${latest.missing?.length || 0} missing and ${latest.unexpected?.length || 0} unexpected item(s) for review.`,
    });
  }

  return {
    method: 'rule-based',
    isAiGenerated: false,
    disclaimer: RULE_BASED_SUMMARY_DISCLAIMER,
    sourceCounts: {
      profile: [profile.fullName, profile.dateOfBirth, profile.allergies, profile.conditions].filter(Boolean).length,
      medicines: medicines.length,
      prescriptions: prescriptions.length,
      reconciliations: reconciliations.length,
    },
    profileSignals: {
      hasName: Boolean(profile.fullName),
      hasDateOfBirth: Boolean(profile.dateOfBirth),
      hasAllergies: Boolean(profile.allergies),
      hasConditions: Boolean(profile.conditions),
    },
    findings,
  };
}

function parseProviderPayload(payload) {
  const content = payload?.choices?.[0]?.message?.content ?? payload?.output_text ?? payload?.text;
  if (typeof content !== 'string' || !content.trim()) return null;
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.findings)) return null;
    return {
      method: 'ai-assisted',
      isAiGenerated: true,
      disclaimer: AI_SUMMARY_DISCLAIMER,
      headline: typeof parsed.headline === 'string' ? parsed.headline.slice(0, 300) : 'AI-assisted record draft',
      findings: parsed.findings.slice(0, 20).map((finding) => ({
        type: typeof finding.type === 'string' ? finding.type.slice(0, 60) : 'review',
        severity: ['info', 'review', 'medium', 'high'].includes(finding.severity) ? finding.severity : 'review',
        title: typeof finding.title === 'string' ? finding.title.slice(0, 200) : 'Review recorded information',
        detail: typeof finding.detail === 'string' ? finding.detail.slice(0, 700) : 'Confirm this point against the source record.',
        source: 'AI-assisted draft; verify against source records',
      })),
    };
  } catch {
    return null;
  }
}

export async function buildSummary(input, adapter = null) {
  if (typeof adapter === 'function') return adapter(input);
  const endpoint = process.env.MEDIHUMAN_SUMMARY_URL;
  const apiKey = process.env.MEDIHUMAN_SUMMARY_API_KEY;
  if (!endpoint || !apiKey) return buildRuleBasedSummary(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.MEDIHUMAN_SUMMARY_MODEL || 'configured-model',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Create cautious clinical-record organization draft. Return JSON only with headline string and findings array. Never diagnose, prescribe, infer hidden facts, or recommend dose changes. Every finding must include type, severity (info/review/medium/high), title, detail.' },
          { role: 'user', content: JSON.stringify(input) },
        ],
      }),
    });
    if (!response.ok) return buildRuleBasedSummary(input);
    return parseProviderPayload(await response.json()) || buildRuleBasedSummary(input);
  } catch {
    return buildRuleBasedSummary(input);
  } finally {
    clearTimeout(timeout);
  }
}
