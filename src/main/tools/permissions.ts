import { isAbsolute, relative, resolve } from 'node:path'
import type { PermissionPolicy, PermissionRequest } from '../../shared/tools'

export interface PermissionsConfig {
  workspace: string
  readPolicy: PermissionPolicy
  writePolicy: PermissionPolicy
}

export type PermissionDecision = 'allow' | 'deny'

export interface PermissionRequester {
  request(req: PermissionRequest): Promise<PermissionDecision>
}

export class Permissions {
  private readonly remembered = new Map<string, PermissionDecision>()

  constructor(
    private readonly getConfig: () => PermissionsConfig,
    private readonly requester: PermissionRequester | null
  ) {}

  private key(req: PermissionRequest): string {
    return `${req.action}:${req.path}`
  }

  isInsideWorkspace(path: string): boolean {
    const workspace = this.getConfig().workspace
    if (workspace === '') return false
    const ws = resolve(workspace)
    const rel = relative(ws, resolve(path))
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  }

  policyFor(req: PermissionRequest): PermissionPolicy {
    if (req.action === 'write') {
      return this.getConfig().writePolicy
    }
    const readPolicy = this.getConfig().readPolicy
    if (this.getConfig().workspace !== '' && this.isInsideWorkspace(req.path)) {
      return readPolicy
    }
    return readPolicy === 'deny' ? 'deny' : 'ask'
  }

  decide(req: PermissionRequest): PermissionDecision | 'ask' {
    const remembered = this.remembered.get(this.key(req))
    if (remembered) {
      return remembered
    }
    return this.policyFor(req)
  }

  async authorize(req: PermissionRequest): Promise<PermissionDecision> {
    const decision = this.decide(req)
    if (decision === 'allow' || decision === 'deny') {
      return decision
    }
    if (!this.requester) {
      return 'deny'
    }
    const answer = await this.requester.request(req)
    if (answer === 'allow') {
      this.remembered.set(this.key(req), 'allow')
    }
    return answer
  }
}
