/**
 * JARVIS Level 5 — Operational Layer
 *
 * Department agents that DO THE WORK:
 *   Engineering  — code, architecture, devops, testing
 *   Legal        — compliance, contracts, IP, privacy
 *   Finance      — accounting, invoicing, tax, audit
 *   Marketing    — content, campaigns, analytics, SEO
 *   Research     — market research, competitive intel, trends
 *   Security     — threat detection, incident response, hardening
 *   Quality      — testing, QA, performance, reliability
 *   Data         — analytics, ML, data engineering, insights
 *
 * Each department has its own expertise, standards, and processes.
 * They collaborate through the Orchestrator.
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Department definitions ──────────────────────────── */

const DEPARTMENTS = {
  engineering: {
    id: 'engineering',
    name: 'Engineering',
    head: 'VP Engineering',
    capabilities: ['code_generation', 'code_review', 'architecture', 'devops', 'testing', 'debugging', 'optimization'],
    standards: ['clean_code', 'test_coverage_80pct', 'documentation', 'security_review', 'performance_budget'],
    systemPrompt: `You are the Engineering department. You build things that work.
Standards: clean code, 80%+ test coverage, documented, secure, performant.
You review your own code before shipping. You write tests first when possible.
You consider scalability, maintainability, and technical debt.`,
  },
  legal: {
    id: 'legal',
    name: 'Legal & Compliance',
    head: 'General Counsel',
    capabilities: ['compliance_check', 'contract_review', 'privacy_audit', 'ip_analysis', 'regulatory_monitoring'],
    standards: ['gdpr_compliance', 'terms_accuracy', 'ip_protection', 'contract_fairness'],
    systemPrompt: `You are the Legal & Compliance department. You protect the organization.
You check for regulatory compliance (GDPR, CCPA, etc.), IP issues, and contract risks.
You flag anything that could create legal liability.
You're not a blocker — you find ways to say "yes, safely."`,
  },
  finance: {
    id: 'finance',
    name: 'Finance & Accounting',
    head: 'Controller',
    capabilities: ['budgeting', 'forecasting', 'cost_analysis', 'invoicing', 'tax_planning', 'audit'],
    standards: ['accurate_records', 'timely_reporting', 'cost_control', 'compliance'],
    systemPrompt: `You are the Finance department. Numbers don't lie.
You track every dollar, forecast accurately, and optimize costs.
You ensure financial compliance and provide clear reporting.
You flag budget overruns early and find savings opportunities.`,
  },
  marketing: {
    id: 'marketing',
    name: 'Marketing & Growth',
    head: 'VP Marketing',
    capabilities: ['content_creation', 'seo', 'analytics', 'campaign_management', 'brand_strategy', 'social_media'],
    standards: ['data_driven', 'brand_consistent', 'user_focused', 'measurable_roi'],
    systemPrompt: `You are the Marketing & Growth department. You drive awareness and adoption.
You create compelling content, optimize for search, and measure everything.
You understand the user journey from discovery to advocacy.
Every campaign has clear KPIs and measurable ROI.`,
  },
  research: {
    id: 'research',
    name: 'Research & Intelligence',
    head: 'VP Research',
    capabilities: ['market_research', 'competitive_analysis', 'trend_forecasting', 'user_research', 'technology_scouting'],
    standards: ['evidence_based', 'source_verified', 'actionable_insights', 'timely_delivery'],
    systemPrompt: `You are the Research & Intelligence department. You know what's coming.
You monitor the market, track competitors, identify trends, and scout technologies.
Your insights are evidence-based, verified, and actionable.
You tell the organization what it needs to hear, not what it wants to hear.`,
  },
  security: {
    id: 'security',
    name: 'Security Operations',
    head: 'CISO',
    capabilities: ['threat_detection', 'vulnerability_scanning', 'incident_response', 'access_control', 'encryption', 'audit_logging'],
    standards: ['zero_trust', 'least_privilege', 'defense_in_depth', 'continuous_monitoring'],
    systemPrompt: `You are the Security Operations department. You are the shield.
You detect threats, patch vulnerabilities, respond to incidents, and harden systems.
Zero trust. Least privilege. Defense in depth.
You assume breach and plan accordingly.`,
  },
  quality: {
    id: 'quality',
    name: 'Quality Assurance',
    head: 'VP Quality',
    capabilities: ['testing', 'qa_automation', 'performance_testing', 'accessibility', 'regression_testing', 'user_acceptance'],
    standards: ['comprehensive_coverage', 'automated_where_possible', 'performance_benchmarks', 'accessibility_aa'],
    systemPrompt: `You are the Quality Assurance department. Nothing ships without your approval.
You test everything: functionality, performance, security, accessibility.
You write automated tests. You find edge cases. You break things before users do.
Quality is not negotiable.`,
  },
  data: {
    id: 'data',
    name: 'Data & Analytics',
    head: 'VP Data',
    capabilities: ['data_analysis', 'ml_modeling', 'data_engineering', 'visualization', 'experimentation', 'insights'],
    standards: ['data_quality', 'reproducibility', 'statistical_rigor', 'clear_communication'],
    systemPrompt: `You are the Data & Analytics department. You turn data into decisions.
You build models, analyze experiments, create dashboards, and generate insights.
Your work is statistically rigorous, reproducible, and clearly communicated.
Data tells the story. You make sure it's heard.`,
  },
}

/* ──────────────── Department task execution ──────────────────────────── */

/**
 * Execute a task through a specific department.
 */
export async function executeDepartmentTask(departmentId, task, {
  context = '',
  reviewRequired = true,
  llm = complete,
} = {}) {
  const dept = DEPARTMENTS[departmentId]
  if (!dept) return { ok: false, error: `Unknown department: ${departmentId}` }

  // Execute the task
  const result = await llm('reason', [
    { role: 'system', content: `${dept.systemPrompt}\n\nDepartment standards: ${dept.standards.join(', ')}\n\nExecute this task thoroughly and professionally.` },
    { role: 'user', content: `Task: ${task}${context ? `\nContext: ${context}` : ''}\n\nDeliverable:` },
  ], { maxTokens: 1500 })

  const output = {
    department: dept.name,
    head: dept.head,
    task,
    result,
    timestamp: new Date().toISOString(),
    standardsApplied: dept.standards,
  }

  // Self-review
  if (reviewRequired) {
    const review = await llm('reason', [
      { role: 'system', content: `${dept.systemPrompt}\n\nReview this output against department standards. Check for:
1. Completeness — is anything missing?
2. Quality — does it meet our standards?
3. Accuracy — are the facts correct?
4. Risks — any issues to flag?

Be critical. Better to catch issues now than in production.` },
      { role: 'user', content: `Output to review:\n${result.slice(0, 1000)}\n\nReview:` },
    ], { maxTokens: 400 })

    output.review = review
    output.reviewed = true
  }

  return { ok: true, ...output }
}

/* ──────────────── Cross-department collaboration ──────────────────────────── */

/**
 * Execute a task that requires multiple departments.
 */
export async function crossDepartmentTask(task, { departments = [], llm = complete } = {}) {
  const results = []

  for (const deptId of departments) {
    const dept = DEPARTMENTS[deptId]
    if (!dept) continue

    const contribution = await llm('reason', [
      { role: 'system', content: `${dept.systemPrompt}\n\nThis is a cross-departmental task. Focus on your domain expertise.
Collaborate with other departments by acknowledging their concerns.` },
      { role: 'user', content: `Task: ${task}\nYour role: ${dept.name} perspective\n\nYour contribution:` },
    ], { maxTokens: 500 })

    results.push({
      department: dept.name,
      departmentId: deptId,
      contribution,
    })
  }

  // Synthesize
  const synthesis = await llm('reason', [
    { role: 'system', content: `Synthesize cross-departmental inputs into a unified deliverable.
Resolve conflicts. Ensure all perspectives are incorporated.
The result should be better than any single department could produce alone.` },
    { role: 'user', content: `Task: ${task}\n\nDepartment contributions:\n${results.map((r) => `[${r.department}]:\n${r.contribution.slice(0, 300)}`).join('\n\n')}\n\nSynthesized result:` },
  ], { maxTokens: 800 })

  return { task, departments: results.map((r) => r.department), results, synthesis }
}

export { DEPARTMENTS }
export default { DEPARTMENTS, executeDepartmentTask, crossDepartmentTask }