/**
 * JARVIS Project Manager — manages projects with tasks, milestones, deadlines.
 *
 *   - Project creation and planning
 *   - Task breakdown (work breakdown structure)
 *   - Milestone tracking
 *   - Deadline management
 *   - Progress reporting
 *   - Risk identification
 *   - Resource allocation
 *
 * "Your website project is 67% complete. 3 tasks remaining.
 *  Deadline is Friday. Current pace: on track.
 *  Risk: API integration may take longer than estimated."
 */

import { complete } from './local-llm.mjs'

/* ──────────────── Project Manager ──────────────────────────── */

class ProjectManager {
  constructor() {
    this.projects = new Map()    // projectId → project
  }

  /**
   * Create a new project.
   */
  async createProject(name, { description = '', deadline = null, llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Create a project plan with work breakdown structure.

Include:
1. Project overview (what, why, for whom)
2. Phases (logical groupings of work)
3. Tasks (specific, actionable, estimable)
4. Dependencies (what blocks what)
5. Milestones (key checkpoints)
6. Estimated timeline
7. Risks and mitigations
8. Success criteria

Make tasks specific and estimable. Not "work on feature" but "implement user login with email/password validation"` },
      { role: 'user', content: `Project: ${name}\n${description ? `Description: ${description}` : ''}\n${deadline ? `Deadline: ${deadline}` : ''}\n\nProject plan:` },
    ], { maxTokens: 1000 })

    const project = {
      id: `proj-${Date.now()}`,
      name,
      description,
      deadline,
      plan: response,
      status: 'active',
      progress: 0,
      tasks: [],
      milestones: [],
      createdAt: new Date().toISOString(),
    }
    this.projects.set(project.id, project)
    return project
  }

  /**
   * Add a task to a project.
   */
  addTask(projectId, description, { priority = 'medium', assignee = 'self', dueDate = null, dependencies = [] } = {}) {
    const project = this.projects.get(projectId)
    if (!project) return null

    const task = {
      id: `task-${Date.now()}`,
      description,
      priority,
      assignee,
      dueDate,
      dependencies,
      status: 'todo', // todo, in_progress, review, done, blocked
      createdAt: new Date().toISOString(),
      completedAt: null,
    }
    project.tasks.push(task)
    this._updateProgress(project)
    return task
  }

  /**
   * Update task status.
   */
  updateTask(projectId, taskId, status) {
    const project = this.projects.get(projectId)
    if (!project) return null

    const task = project.tasks.find((t) => t.id === taskId)
    if (!task) return null

    task.status = status
    if (status === 'done') task.completedAt = new Date().toISOString()
    this._updateProgress(project)
    return task
  }

  /**
   * Get project status report.
   */
  async getProjectReport(projectId, { llm = complete } = {}) {
    const project = this.projects.get(projectId)
    if (!project) return null

    const response = await llm('reason', [
      { role: 'system', content: `Generate a project status report.

Include:
1. Overall status (on track / at risk / behind)
2. Progress summary (tasks completed, remaining)
3. Key accomplishments
4. Blockers and risks
5. Next steps
6. Updated timeline estimate
7. Recommendations

Be honest about problems. Don't sugarcoat.` },
      { role: 'user', content: `Project: ${project.name}\nProgress: ${project.progress}%\nTasks: ${project.tasks.filter((t) => t.status === 'done').length}/${project.tasks.length} done\nDeadline: ${project.deadline || 'none'}\n\nTasks:\n${project.tasks.map((t) => `- [${t.status}] ${t.description}`).join('\n')}\n\nStatus report:` },
    ], { maxTokens: 600 })

    return response
  }

  /**
   * Break down a task into subtasks.
   */
  async breakDownTask(taskDescription, { llm = complete } = {}) {
    const response = await llm('reason', [
      { role: 'system', content: `Break this task into specific, actionable subtasks.

Each subtask should be:
- Specific (clear what to do)
- Small (completable in 1-4 hours)
- Estimable (can estimate effort)
- Testable (can verify it's done)

Aim for 3-7 subtasks. Not too granular, not too broad.` },
      { role: 'user', content: `Task: ${taskDescription}\n\nSubtasks:` },
    ], { maxTokens: 400 })

    return response
  }

  _updateProgress(project) {
    if (project.tasks.length === 0) {
      project.progress = 0
      return
    }
    const done = project.tasks.filter((t) => t.status === 'done').length
    project.progress = Math.round((done / project.tasks.length) * 100)
  }

  /**
   * Get all projects summary.
   */
  getSummary() {
    return Array.from(this.projects.values()).map((p) => ({
      id: p.id,
      name: p.name,
      progress: p.progress,
      tasks: {
        total: p.tasks.length,
        todo: p.tasks.filter((t) => t.status === 'todo').length,
        inProgress: p.tasks.filter((t) => t.status === 'in_progress').length,
        done: p.tasks.filter((t) => t.status === 'done').length,
      },
      deadline: p.deadline,
      status: p.status,
    }))
  }
}

/* ──────────────── Singleton ──────────────────────────── */

const projectManager = new ProjectManager()

export { projectManager, ProjectManager }
export default projectManager