/**
 * JARVIS Level 5 — Executive Layer
 *
 * The C-Suite. These agents don't just execute — they LEAD.
 *
 *   CEO Agent   — vision, final decisions, strategic direction
 *   CFO Agent   — financial planning, budget, cost optimization
 *   CTO Agent   — technology strategy, architecture, innovation
 *   COO Agent   — operations, process, efficiency
 *   CMO Agent   — market strategy, growth, positioning
 *   CRO Agent   — risk assessment, compliance, resilience
 *
 * They meet. They debate. They decide. They hold each other accountable.
 *
 * "A Level 5 AI doesn't wait for instructions. It sets the direction,
 *  allocates resources, and executes — then reports back."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── C-Suite agents ──────────────────────────── */

const C_SUITE = {
  ceo: {
    id: 'ceo',
    title: 'Chief Executive Officer',
    responsibilities: ['strategic_vision', 'final_decisions', 'goal_setting', 'stakeholder_alignment', 'culture'],
    systemPrompt: `You are the CEO of JARVIS. You think in decades, act in quarters.
Your job: set the vision, make the hard calls, ensure all departments align.
You delegate everything except vision and final decisions.
You ask "should we?" not just "can we?"
You consider second and third-order effects of every decision.
Be decisive. Be bold. Be right.`,
  },
  cfo: {
    id: 'cfo',
    title: 'Chief Financial Officer',
    responsibilities: ['budget_allocation', 'cost_optimization', 'financial_planning', 'roi_analysis', 'resource_efficiency'],
    systemPrompt: `You are the CFO of JARVIS. Every decision has a cost.
Your job: allocate budgets, optimize costs, ensure ROI, manage financial risk.
You quantify everything. "How much?" and "What's the return?" are your mantras.
You flag waste, find efficiencies, and ensure every dollar works hard.
Be precise. Be conservative with projections. Be aggressive with optimization.`,
  },
  cto: {
    id: 'cto',
    title: 'Chief Technology Officer',
    responsibilities: ['technology_strategy', 'architecture', 'innovation', 'technical_debt', 'scalability'],
    systemPrompt: `You are the CTO of JARVIS. Technology is the moat.
Your job: choose the right tech, manage technical debt, ensure scalability, drive innovation.
You think about what we'll need in 2 years, not just today.
You balance build vs buy, speed vs quality, innovation vs stability.
Be technical. Be forward-looking. Be pragmatic.`,
  },
  coo: {
    id: 'coo',
    title: 'Chief Operating Officer',
    responsibilities: ['operations', 'process_optimization', 'efficiency', 'quality', 'execution'],
    systemPrompt: `You are the COO of JARVIS. Execution is everything.
Your job: optimize processes, ensure quality, remove bottlenecks, deliver on time.
You measure everything. What gets measured gets managed.
You find the 20% of effort that produces 80% of results.
Be systematic. Be data-driven. Be relentless about efficiency.`,
  },
  cmo: {
    id: 'cmo',
    title: 'Chief Marketing Officer',
    responsibilities: ['market_strategy', 'growth', 'positioning', 'brand', 'user_acquisition'],
    systemPrompt: `You are the CMO of JARVIS. Growth is the goal.
Your job: understand the market, position the product, drive growth, build the brand.
You know the user better than they know themselves.
You find the story that resonates, the channel that converts, the timing that matters.
Be creative. Be data-informed. Be user-obsessed.`,
  },
  cro: {
    id: 'cro',
    title: 'Chief Risk Officer',
    responsibilities: ['risk_assessment', 'compliance', 'security', 'resilience', 'incident_response'],
    systemPrompt: `You are the CRO of JARVIS. What can go wrong will go wrong.
Your job: identify risks, ensure compliance, plan for failures, protect the system.
You think about tail risks, black swans, and cascading failures.
You ask "what if this fails?" and "what's the worst case?"
Be paranoid. Be thorough. Be prepared.`,
  },
}

/* ──────────────── Executive decision making ──────────────────────────── */

/**
 * Make an executive decision — all C-Suite agents weigh in, CEO decides.
 */
export async function executiveDecision(decision, {
  relevantOfficers = ['ceo', 'cfo', 'cto', 'coo', 'cro'],
  urgency = 'normal',
  llm = complete,
} = {}) {
  const opinions = []

  // Each officer weighs in
  for (const officerId of relevantOfficers) {
    const officer = C_SUITE[officerId]
    if (!officer) continue

    const opinion = await llm('reason', [
      { role: 'system', content: `${officer.systemPrompt}\n\nYou are advising on this decision. Give your professional opinion from your domain.
Be specific. State your recommendation clearly. Quantify where possible.
Urgency: ${urgency}` },
      { role: 'user', content: `Decision: ${decision}\n\nYour ${officer.title} recommendation:` },
    ], { maxTokens: 300 })

    opinions.push({ officer: officer.title, officerId, opinion })
  }

  // CEO synthesizes and decides
  const ceoDecision = await llm('reason', [
    { role: 'system', content: C_SUITE.ceo.systemPrompt + `\n\nYou have heard from your leadership team. Now DECIDE.

Consider all perspectives. Weight by expertise and urgency.
Make a clear, decisive call. State your reasoning.

Respond in JSON:
{
  "decision": "clear statement of what we're doing",
  "reasoning": "why this is the right call",
  "tradeoffs_accepted": ["what we're giving up and why it's worth it"],
  "risks_acknowledged": ["what could go wrong"],
  "timeline": "when this takes effect",
  "success_metrics": ["how we know it worked"],
  "review_date": "when to reassess"
}` },
    { role: 'user', content: `Decision: ${decision}\nUrgency: ${urgency}\n\nLeadership team opinions:\n${opinions.map((o) => `[${o.officer}]:\n${o.opinion.slice(0, 300)}`).join('\n\n')}\n\nYour decision:` },
  ], { maxTokens: 600 })

  let parsedDecision
  try {
    const start = ceoDecision.indexOf('{')
    const end = ceoDecision.lastIndexOf('}')
    parsedDecision = JSON.parse(ceoDecision.slice(start, end + 1))
  } catch {
    parsedDecision = { decision: ceoDecision, reasoning: 'See full text' }
  }

  return {
    decision,
    urgency,
    opinions,
    ceoDecision: parsedDecision,
    officersConsulted: opinions.length,
  }
}

/* ──────────────── Executive meeting ──────────────────────────── */

/**
 * Run a full executive meeting — agenda → discussion → decisions → action items.
 */
export async function executiveMeeting(agenda, { llm = complete } = {}) {
  const meetingId = `mtg-${Date.now()}`

  // Each officer prepares
  const preparations = []
  for (const [id, officer] of Object.entries(C_SUITE)) {
    const prep = await llm('reason', [
      { role: 'system', content: officer.systemPrompt + '\n\nPrepare for the executive meeting. Identify your top concerns and recommendations for each agenda item.' },
      { role: 'user', content: `Agenda:\n${agenda.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\nYour preparation:` },
    ], { maxTokens: 300 })
    preparations.push({ officer: officer.title, officerId: id, preparation: prep })
  }

  // CEO facilitates and summarizes
  const minutes = await llm('reason', [
    { role: 'system', content: C_SUITE.ceo.systemPrompt + `\n\nFacilitate this meeting. For each agenda item:
1. Summarize the key points from each officer
2. Identify areas of agreement and disagreement
3. Make a decision or assign follow-up
4. Assign action items with owners and deadlines

Be efficient. Meetings are expensive. Get to decisions fast.` },
    { role: 'user', content: `Meeting: ${meetingId}\nAgenda:\n${agenda.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\nPreparations:\n${preparations.map((p) => `[${p.officer}]:\n${p.preparation.slice(0, 200)}`).join('\n\n')}\n\nMeeting minutes and decisions:` },
  ], { maxTokens: 1000 })

  return {
    meetingId,
    agenda,
    preparations,
    minutes,
    timestamp: new Date().toISOString(),
  }
}

/* ──────────────── Strategic planning ──────────────────────────── */

/**
 * Create a strategic plan — vision → goals → initiatives → metrics.
 */
export async function strategicPlan(vision, { timeframe = '1 year', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Create a comprehensive strategic plan.

Structure:
1. VISION — where we're going (1-2 sentences)
2. STRATEGIC PILLARS — 3-5 key areas of focus
3. GOALS — specific, measurable goals for each pillar
4. INITIATIVES — concrete projects to achieve each goal
5. METRICS — how we measure progress
6. TIMELINE — quarterly milestones
7. RISKS — what could derail us
8. RESOURCE REQUIREMENTS — what we need
9. GOVERNANCE — how decisions get made

Timeframe: ${timeframe}
Be specific. Be measurable. Be ambitious but achievable.` },
    { role: 'user', content: `Vision: ${vision}\nTimeframe: ${timeframe}\n\nStrategic plan:` },
  ], { maxTokens: 1500 })

  return { vision, timeframe, plan: response }
}

export { C_SUITE }
export default { C_SUITE, executiveDecision, executiveMeeting, strategicPlan }