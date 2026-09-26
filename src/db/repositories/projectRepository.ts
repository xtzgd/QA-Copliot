import { Environment, Project } from '../../shared/types/session';
import { db, QACopilotDatabase } from '../index';

const DEFAULT_PROJECTS: Project[] = [
  { id: 'proj-shop', name: '商城系统', createdAt: 1 },
  { id: 'proj-crm', name: 'CRM系统', createdAt: 2 },
  { id: 'proj-finance', name: '财务管理系统', createdAt: 3 },
];

const DEFAULT_ENVIRONMENTS: Environment[] = DEFAULT_PROJECTS.flatMap((project) =>
  (['DEV', 'TEST', 'UAT', 'PROD'] as const).map((name) => ({
    id: `${project.id}-${name}`,
    projectId: project.id,
    name,
    baseUrl: project.id === 'proj-shop'
      ? `https://${name === 'PROD' ? 'www' : name.toLowerCase()}.xxx.com`
      : '',
  }))
);

export class ProjectRepository {
  constructor(private database: QACopilotDatabase = db) {}

  async ensureDefaults(): Promise<void> {
    await this.database.transaction(
      'rw',
      this.database.projects,
      this.database.environments,
      async () => {
        for (const project of DEFAULT_PROJECTS) {
          if (!(await this.database.projects.get(project.id))) await this.database.projects.add(project);
        }
        for (const environment of DEFAULT_ENVIRONMENTS) {
          if (!(await this.database.environments.get(environment.id))) {
            await this.database.environments.add(environment);
          }
        }
      }
    );
  }

  async listProjects(): Promise<Project[]> {
    return this.database.projects.orderBy('createdAt').toArray();
  }

  async getProjectByName(name: string): Promise<Project | undefined> {
    return this.database.projects.where('name').equals(name).first();
  }

  async listEnvironments(projectId: string): Promise<Environment[]> {
    return this.database.environments.where('projectId').equals(projectId).toArray();
  }

  async upsertEnvironment(environment: Environment): Promise<void> {
    await this.database.environments.put(environment);
  }
}

export const projectRepo = new ProjectRepository();
