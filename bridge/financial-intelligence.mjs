/**
 * JARVIS Financial Intelligence — personal finance management.
 *
 *   - Track income and expenses
 *   - Budget creation and monitoring
 *   - Investment analysis
 *   - Tax planning
 *   - Financial goal tracking
 *   - Spending pattern analysis
 *
 * "I don't just track your money. I help you BUILD WEALTH."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Financial Intelligence ──────────────────────────── */

class FinancialIntelligence {
  constructor() {
    this.transactions = []
    this.budgets = new Map()        // category → {limit, spent}
    this.accounts = new Map()       // name → {balance, type}
    this.goals = []                 // financial goals
  }

  /**
   * Add a transaction.
   */
  addTransaction(amount, { type = 'expense', category = '', description = '', date = new Date() } = {}) {
    const transaction = {
      id: `txn-${Date.now()}`,
      amount,
      type, // income, expense, transfer
      category,
      description,
      date: date.toISOString(),
    }
    this.transactions.push(transaction)

    // Update budget
    if (type === 'expense' && category) {
      const budget = this.budgets.get(category)
      if (budget) budget.spent += amount
    }

    return transaction
  }

  /**
   * Set a budget.
   */
  setBudget(category, limit, { period = 'monthly' } = {}) {
    const spent = this.transactions
      .filter((t) => t.type === 'expense' && t.category === category)
      .reduce((sum, t) => sum + t.amount, 0)

    this.budgets.set(category, { limit, spent, period })
  }

  /**
   * Analyze spending patterns.
   */
  async analyzeSpending({ period = 'month', llm = complete } = {}) {
    const recent = this.transactions.filter((t) => {
      const date = new Date(t.date)
      const now = new Date()
      const diffDays = (now - date) / 86400000
      return period === 'month' ? diffDays <= 30 : diffDays <= 7
    })

    const byCategory = {}
    for (const t of recent) {
      if (t.type !== 'expense') continue
      byCategory[t.category] = (byCategory[t.category] || 0) + t.amount
    }

    const response = await llm('reason', [
      { role: 'system', content: `Analyze spending patterns and provide insights.

For each category:
- How much was spent
- Is it reasonable?
- How does it compare to typical budgets?
- Suggestions for reduction

Overall:
- Total income vs expenses
- Savings rate
- Biggest opportunities to save
- Financial health score (1-10)` },
      { role: 'user', content: `Period: ${period}\n\nSpending by category:\n${Object.entries(byCategory).map(([cat, amt]) => `- ${cat}: ₹${amt}`).join('\n')}\n\nTotal transactions: ${recent.length}\n\nSpending analysis:` },
    ], { maxTokens: 600 })

    return response
  }

  /**
   * Create a budget plan.
   */
  async createBudget(income, { goals = [], llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Create a realistic budget plan.

Framework: 50/30/20 rule (needs/wants/savings) adjusted for Indian context.

Consider:
- Essential expenses (rent, food, transport, utilities)
- Discretionary spending (entertainment, shopping)
- Savings and investments
- Emergency fund
- Financial goals

Make it specific with actual amounts.` },
      { role: 'user', content: `Monthly income: ₹${income}\nGoals: ${goals.join(', ') || 'general savings'}\n\nBudget plan:` },
    ], { maxTokens: 600 })

    return response
  }

  /**
   * Get financial summary.
   */
  getSummary() {
    const income = this.transactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0)
    const expenses = this.transactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0)

    return {
      income,
      expenses,
      balance: income - expenses,
      savingsRate: income > 0 ? (((income - expenses) / income) * 100).toFixed(1) + '%' : 'N/A',
      transactionCount: this.transactions.length,
      budgetCount: this.budgets.size,
      goalCount: this.goals.length,
    }
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const financialIntelligence = new FinancialIntelligence()

export { financialIntelligence, FinancialIntelligence }
export default financialIntelligence