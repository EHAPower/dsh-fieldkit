import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  FieldkitBinding,
  FieldkitBindingRequest,
  FieldkitCancelReadRunRequest,
  FieldkitConfigurationCheck,
  FieldkitDescribe,
  FieldkitOpenTargetRequest,
  FieldkitReadRun,
  FieldkitReadRunRequest,
  FieldkitService,
  FieldkitSnapshot,
  FieldkitTargets,
} from './remote-types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    fieldkit: FieldkitService
    fieldkitRemote: FieldkitRemote
  }
}

export class FieldkitRemote extends TypertRemoteService {
  static inject = ['fieldkit']

  constructor(ctx: Context) {
    super(ctx, 'fieldkitRemote', { namespace: 'fieldkit' })
  }

  @Remote('describe')
  describe(): Promise<FieldkitDescribe> { return this.ctx.fieldkit.describe() }

  @Remote('listTargets')
  listTargets(sessionId: string): Promise<FieldkitTargets> { return this.ctx.fieldkit.listTargets(sessionId) }

  @Remote('openTarget')
  openTarget(sessionId: string, request: FieldkitOpenTargetRequest): Promise<FieldkitBinding> { return this.ctx.fieldkit.openTarget(sessionId, request) }

  @Remote('getSnapshot')
  getSnapshot(sessionId: string, request: FieldkitBindingRequest): Promise<FieldkitSnapshot> { return this.ctx.fieldkit.getSnapshot(sessionId, request) }

  @Remote('diagnose')
  diagnose(sessionId: string, request: FieldkitBindingRequest): Promise<FieldkitReadRun> { return this.ctx.fieldkit.diagnose(sessionId, request) }

  @Remote('getReadRun')
  getReadRun(sessionId: string, request: FieldkitReadRunRequest): Promise<FieldkitReadRun | null> { return this.ctx.fieldkit.getReadRun(sessionId, request) }

  @Remote('cancelReadRun')
  cancelReadRun(sessionId: string, request: FieldkitCancelReadRunRequest): Promise<FieldkitReadRun> { return this.ctx.fieldkit.cancelReadRun(sessionId, request) }

  @Remote('detachTarget')
  detachTarget(sessionId: string, request: FieldkitBindingRequest): Promise<FieldkitBinding> { return this.ctx.fieldkit.detachTarget(sessionId, request) }

  @Remote('checkConfiguration')
  checkConfiguration(rawRecordText: string): Promise<FieldkitConfigurationCheck> { return this.ctx.fieldkit.checkConfiguration(rawRecordText) }

  @Remote('hasReport')
  hasReport(sessionId: string, path: string): Promise<boolean> { return this.ctx.fieldkit.hasReport(sessionId, path) }
}
