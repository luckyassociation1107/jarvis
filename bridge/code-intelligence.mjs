/**
 * JARVIS Code Intelligence — not just generating code. UNDERSTANDING codebases.
 *
 *   - Reads and understands entire codebases
 *   - Finds bugs, security issues, performance problems
 *   - Suggests refactoring
 *   - Generates tests
 *   - Explains code in plain language
 *   - Creates documentation
 *   - Handles git operations
 *
 * "I don't just write code. I understand your ENTIRE codebase."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Code Intelligence ──────────────────────────── */

/**
 * Analyze an entire codebase.
 */
export async function analyzeCodebase(files, { question = '', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Analyze this codebase comprehensively.

Provide:
1. ARCHITECTURE — how the code is structured
2. PATTERNS — design patterns used
3. QUALITY — code quality assessment (1-10)
4. BUGS — potential bugs or issues
5. SECURITY — security vulnerabilities
6. PERFORMANCE — performance bottlenecks
7. TECH DEBT — areas needing refactoring
8. DOCUMENTATION — what's missing
9. TESTS — test coverage gaps
10. SUGGESTIONS — top 3 improvements

Be specific with file names and line numbers.` },
    { role: 'user', content: `Files:\n${files.map((f) => `--- ${f.name} ---\n${f.content?.slice(0, 500)}`).join('\n\n')}\n${question ? `\nSpecific question: ${question}` : ''}\n\nCodebase analysis:` },
  ], { maxTokens: 1500 })

  return response
}

/**
 * Find and fix bugs.
 */
export async function findBugs(code, { language = 'auto', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Find ALL bugs in this code. Be thorough.

Check for:
1. Logic errors
2. Off-by-one errors
3. Null/undefined handling
4. Race conditions
5. Memory leaks
6. Error handling gaps
7. Edge cases
8. Type mismatches
9. Security vulnerabilities
10. Performance issues

For each bug:
- Location (line number)
- Severity (critical/high/medium/low)
- Description
- Fix (code)

Language: ${language}` },
    { role: 'user', content: `Code:\n\`\`\`\n${code}\n\`\`\`\n\nBugs found:` },
  ], { maxTokens: 1000 })

  return response
}

/**
 * Generate tests for code.
 */
export async function generateTests(code, { framework = 'auto', coverage = 'comprehensive', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Generate comprehensive tests for this code.

Include:
1. Unit tests for each function
2. Edge case tests
3. Error handling tests
4. Integration tests (if applicable)
5. Performance tests (if relevant)

Framework: ${framework}
Coverage goal: ${coverage}

Write REAL, runnable tests. Not pseudocode.` },
    { role: 'user', content: `Code:\n\`\`\`\n${code}\n\`\`\`\n\nTests:` },
  ], { maxTokens: 1500 })

  return response
}

/**
 * Explain code in plain language.
 */
export async function explainCode(code, { audience = 'developer', llm = complete } = {}) {
  const response = await llm('chat', [
    { role: 'system', content: `Explain this code clearly and completely.

Audience: ${audience}

Cover:
1. What it does (one sentence)
2. How it works (step by step)
3. Key decisions (why it's done this way)
4. Potential issues
5. How to use it

Use analogies for complex parts. Be clear, not verbose.` },
    { role: 'user', content: `Code:\n\`\`\`\n${code}\n\`\`\`\n\nExplanation:` },
  ], { maxTokens: 800 })

  return response
}

/**
 * Refactor code for better quality.
 */
export async function refactorCode(code, { goal = 'readability', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Refactor this code for ${goal}.

Improvements:
1. Better naming
2. Extract functions
3. Reduce complexity
4. Remove duplication
5. Improve error handling
6. Add type safety
7. Optimize performance
8. Better documentation

Show the refactored code with explanations of what changed and why.` },
    { role: 'user', content: `Code:\n\`\`\`\n${code}\n\`\`\`\nGoal: ${goal}\n\nRefactored:` },
  ], { maxTokens: 1500 })

  return response
}

/**
 * Git operations intelligence.
 */
export async function gitIntelligence(repo, { task = 'status', llm = complete } = {}) {
  const response = await llm('reason', [
    { role: 'system', content: `Help with git operations. Be precise and safe.

For each operation:
1. Explain what it will do
2. Show the exact command
3. Warn about risks
4. Suggest a safety backup if needed

Never suggest destructive operations without warning.` },
    { role: 'user', content: `Repository: ${repo}\nTask: ${task}\n\nGit guidance:` },
  ], { maxTokens: 500 })

  return response
}

export default { analyzeCodebase, findBugs, generateTests, explainCode, refactorCode, gitIntelligence }