/**
 * JARVIS Level 5 — Resource Manager
 *
 * Autonomous resource and capital management:
 *   - Budget allocation across departments
 *   - Compute provisioning and optimization
 *   - Vendor evaluation and negotiation
 *   - Cost tracking and optimization
 *   - Contract management
 *   - ROI analysis for all expenditures
 *
 * "I don't just spend money. I INVEST it. Every dollar must work."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Budget management ──────────────────────────── */

class ResourceManager {
  constructor() {
    this.budgets = new Map()       // department → {allocated, spent, committed}
    this.vendors = new Map()       // vendorId → {name, cost, quality, contract}
    this.contracts = []            // active contracts
    this.expenses = []             // all expenses
    this.computeResources = []     // servers, APIs, etc.
  }

  /**
   * Set budget for a department.
   */
  setBudget(department, amount, { period = 'monthly', notes = '' } = {}) {
    this.budgets.set(department, {
      department,
      allocated: amount,
      spent: 0,
      committed: 0,
      period,
      notes,
      setAt: new Date().toISOString(),
    })
  }

  /**
   * Record an expense.
   */
  recordExpense(department, amount, { description = '', vendor = '', category = '' } = {}) {
    const budget = this.budgets.get(department)
    if (budget) {
      budget.spent += amount
    }

    this.expenses.push({
      department,
      amount,
      description,
      vendor,
      category,
      timestamp: new Date().toISOString(),
    })

    // Check budget
    if (budget && budget.spent > budget.allocated) {
      return {
        ok: true,
        warning: true,
        message: `Budget exceeded for ${department}: $${budget.spent}/$${budget.allocated}`,
        overage: budget.spent - budget.allocated,
      }
    }

    return { ok: true, warning: false }
  }

  /**
   * Evaluate a vendor.
   */
  async evaluateVendor(vendorName, { options = [], llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Evaluate this vendor/service for procurement.

Consider:
1. Cost (pricing model, hidden fees, scalability of pricing)
2. Quality (reliability, performance, support)
3. Risk (vendor lock-in, single point of failure, data security)
4. Alternatives (what else is available)
5. Negotiation leverage (what can we negotiate)
6. Contract terms (what to watch for)

Respond in JSON:
{
  "vendor": "...",
  "score": 8.5,
  "pros": ["pro 1", "pro 2"],
  "cons": ["con 1", "con 2"],
  "cost_assessment": "competitive|expensive|cheap",
  "risk_level": "low|medium|high",
  "recommendation": "proceed|negotiate|avoid",
  "negotiation_points": ["point 1", "point 2"],
  "alternatives": ["alternative 1"]
}` },
      { role: 'user', content: `Vendor: ${vendorName}\nOptions: ${options.join(', ') || 'not specified'}\n\nEvaluation:` },
    ], { maxTokens: 600 })

    try {
      const start = response.indexOf('{')
      const end = response.lastIndexOf('}')
      return { ok: true, evaluation: JSON.parse(response.slice(start, end + 1)) }
    } catch {
      return { ok: false, raw: response }
    }
  }

  /**
   * Optimize compute resources.
   */
  async optimizeCompute({ llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Optimize compute resource allocation.

Consider:
1. Current utilization — are we over-provisioned?
2. Scaling needs — when do we need more?
3. Cost optimization — reserved vs on-demand, spot instances
4. Performance — are we meeting SLAs?
5. Redundancy — are we resilient to failures?

Provide specific, actionable recommendations.` },
      { role: 'user', content: `Current resources:\n${JSON.stringify(this.computeResources).slice(0, 500) || 'No resources tracked yet'}\n\nOptimization recommendations:` },
    ], { maxTokens: 500 })

    return response
  }

  /**
   * Generate financial report.
   */
  getFinancialReport() {
    const totalBudget = Array.from(this.budgets.values()).reduce((sum, b) => sum + b.allocated, 0)
    const totalSpent = Array.from(this.budgets.values()).reduce((sum, b) => sum + b.spent, 0)
    const departments = Array.from(this.budgets.values()).map((b) => ({
      department: b.department,
      allocated: b.allocated,
      spent: b.spent,
      remaining: b.allocated - b.spent,
      utilization: ((b.spent / b.allocated) * 100).toFixed(1) + '%',
    }))

    return {
      totalBudget,
      totalSpent,
      remaining: totalBudget - totalSpent,
      utilization: totalBudget ? ((totalSpent / totalBudget) * 100).toFixed(1) + '%' : '0%',
      departments,
      expenseCount: this.expenses.length,
      contractCount: this.contracts.length,
    }
  }
}

export { ResourceManager }
export default { ResourceManager }