/**
 * JARVIS Threat Modeler — red team thinking for security.
 *
 * Thinks like an ATTACKER to protect like a DEFENDER:
 *   - Enumerates attack surfaces
 *   - Identifies vulnerabilities
 *   - Simulates attack scenarios
 *   - Generates defensive recommendations
 *   - Monitors for suspicious patterns
 *   - Incident response planning
 *
 * "To protect a castle, you must think like someone who wants to burn it down."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Threat modeling ──────────────────────────── */

/**
 * Generate a comprehensive threat model.
 */
export async function modelThreats(target, { 
  assetType = 'application',  // application, network, data, physical, social
  attackerProfile = 'external',
  llm = complete,
} = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `You are a cybersecurity threat modeler. Think like an attacker.

For the target system:
1. Enumerate the attack surface (every entry point)
2. Identify assets worth attacking
3. Map attack vectors (how to get in)
4. Assess vulnerability likelihood
5. Calculate risk = likelihood × impact
6. Prioritize by risk level
7. Recommend mitigations

Attacker profile: ${attackerProfile}
Consider: STRIDE (Spoofing, Tampering, Repudiation, Info Disclosure, DoS, Elevation)

Respond in JSON:
{
  "assets": [{ "name": "...", "value": "high|medium|low", "description": "..." }],
  "attack_vectors": [
    {
      "name": "...",
      "likelihood": "high|medium|low",
      "impact": "critical|high|medium|low",
      "risk": "critical|high|medium|low",
      "technique": "how the attack works",
      "mitigation": "how to prevent it"
    }
  ],
  "priorities": ["top 3 risks to address first"],
  "overall_risk": "critical|high|medium|low"
}` },
    { role: 'user', content: `Target: ${target}\nAsset type: ${assetType}\n\nThreat model:` },
  ], { maxTokens: 1200 })

  try {
    const start = response.indexOf('{')
    const end = response.lastIndexOf('}')
    return { ok: true, model: JSON.parse(response.slice(start, end + 1)) }
  } catch {
    return { ok: false, raw: response }
  }
}

/* ──────────────── Red team simulation ──────────────────────────── */

/**
 * Simulate an attack scenario.
 */
export async function redTeam(target, { objective = 'gain access', constraints = [], llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `You are a red team operator. Plan an attack (for defensive purposes only).

Your goal is to find weaknesses by simulating a real attacker.

Plan:
1. Reconnaissance — what can be learned without touching the target
2. Scanning — active probing
3. Gaining access — exploit vulnerabilities
4. Maintaining access — persistence
5. Covering tracks — evasion

This is for DEFENSIVE security testing only.` },
    { role: 'user', content: `Target: ${target}\nObjective: ${objective}\nConstraints: ${constraints.join(', ') || 'none'}\n\nRed team plan:` },
  ], { maxTokens: 800 })

  return { target, objective, plan: response }
}

/* ──────────────── Incident response ──────────────────────────── */

/**
 * Generate an incident response plan.
 */
export async function incidentResponse(incident, { llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Generate an incident response plan. Be methodical.

Phases:
1. IDENTIFICATION — what happened, scope, severity
2. CONTAINMENT — stop the bleeding (short-term and long-term)
3. ERADICATION — remove the threat
4. RECOVERY — restore normal operations
5. LESSONS LEARNED — what to improve

For each phase, specify:
- Actions to take (in order)
- Who is responsible
- Tools needed
- Success criteria
- Timeline` },
    { role: 'user', content: `Incident: ${incident}\n\nIncident response plan:` },
  ], { maxTokens: 1000 })

  return { incident, plan: response }
}

/* ──────────────── Security audit ──────────────────────────── */

/**
 * Audit code or configuration for security issues.
 */
export async function securityAudit(code, { language = 'auto', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Perform a security audit on this code. Look for:

Vulnerabilities:
- SQL injection, XSS, CSRF, SSRF
- Authentication/authorization flaws
- Insecure deserialization
- Sensitive data exposure
- Broken access control
- Security misconfiguration
- Hardcoded secrets/credentials
- Insecure dependencies
- Race conditions
- Buffer overflows (for C/C++)

For each finding:
- Severity (critical/high/medium/low)
- Location (line number)
- Description
- Remediation

Language: ${language}` },
    { role: 'user', content: `Code to audit:\n\`\`\`\n${code}\n\`\`\`\n\nSecurity findings:` },
  ], { maxTokens: 1000 })

  return response
}

/* ──────────────── Password analysis ──────────────────────────── */

/**
 * Analyze password strength (educational).
 */
export function analyzePassword(password) {
  const checks = {
    length: password.length >= 12,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    numbers: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
    noCommon: !['password', '123456', 'qwerty', 'admin'].some((c) => password.toLowerCase().includes(c)),
    noRepeating: !/(.)\1{2,}/.test(password),
    noSequential: !/(?:abc|bcd|cde|def|efg|123|234|345|456|567|678|789)/.test(password.toLowerCase()),
  }

  const passed = Object.values(checks).filter(Boolean).length
  const total = Object.keys(checks).length
  const score = Math.round((passed / total) * 100)

  let strength = 'critical'
  if (score >= 90) strength = 'excellent'
  else if (score >= 70) strength = 'strong'
  else if (score >= 50) strength = 'moderate'
  else if (score >= 30) strength = 'weak'

  return {
    score,
    strength,
    checks,
    passed,
    failed: total - passed,
    suggestion: score < 90 ? 'Consider using a password manager to generate a strong unique password' : 'Strong password!',
  }
}

export default { modelThreats, redTeam, incidentResponse, securityAudit, analyzePassword }