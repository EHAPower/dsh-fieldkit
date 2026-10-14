import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { FieldkitCommandRequest, FieldkitCommandResult, FieldkitConfigurationCheck, FieldkitContext, FieldkitDescribe, FieldkitService, FieldkitServiceSettings, FieldkitServiceStatus, FieldkitShutdownRequest, FieldkitTargetContext } from './remote-types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    fieldkit: FieldkitService
    fieldkitRemote: FieldkitRemote
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap { 'fieldkit/service': { readonly code: string } }
}

export function fieldkitRemoteFailure(error: unknown): never {
  const value = error as { code?: unknown; message?: unknown }
  const code = typeof value?.code === 'string' ? value.code : 'backend_error'
  const message = typeof value?.message === 'string' ? value.message : 'eha-tool request failed.'
  throw new RemoteError('fieldkit/service', message, { code })
}

export class FieldkitRemote extends TypertRemoteService {
  static inject = ['fieldkit']
  constructor(ctx: Context) { super(ctx, 'fieldkitRemote', { namespace: 'fieldkit' }) }

  @Remote('serviceStatus')
  serviceStatus(): Promise<FieldkitServiceStatus> { return Promise.resolve().then(() => this.ctx.fieldkit.serviceStatus()).catch(fieldkitRemoteFailure) }
  @Remote('saveServiceSettings')
  saveServiceSettings(request: FieldkitServiceSettings): Promise<FieldkitServiceStatus> { return Promise.resolve().then(() => this.ctx.fieldkit.saveServiceSettings(request)).catch(fieldkitRemoteFailure) }
  @Remote('startService')
  startService(): Promise<FieldkitServiceStatus> { return Promise.resolve().then(() => this.ctx.fieldkit.startService()).catch(fieldkitRemoteFailure) }
  @Remote('attachService')
  attachService(): Promise<FieldkitServiceStatus> { return Promise.resolve().then(() => this.ctx.fieldkit.attachService()).catch(fieldkitRemoteFailure) }
  @Remote('shutdownService')
  shutdownService(request: FieldkitShutdownRequest): Promise<FieldkitServiceStatus> { return Promise.resolve().then(() => this.ctx.fieldkit.shutdownService(request)).catch(fieldkitRemoteFailure) }
  @Remote('describe')
  describe(): Promise<FieldkitDescribe> { return Promise.resolve().then(() => this.ctx.fieldkit.describe()).catch(fieldkitRemoteFailure) }
  @Remote('selectTarget')
  selectTarget(sessionId: string, request: FieldkitTargetContext): Promise<FieldkitContext> { return Promise.resolve().then(() => this.ctx.fieldkit.selectTarget(sessionId, request)).catch(fieldkitRemoteFailure) }
  @Remote('context')
  context(sessionId: string): Promise<FieldkitContext> { return Promise.resolve().then(() => this.ctx.fieldkit.context(sessionId)).catch(fieldkitRemoteFailure) }
  @Remote('executeCommand')
  executeCommand(sessionId: string, request: FieldkitCommandRequest): Promise<FieldkitCommandResult> { return Promise.resolve().then(() => this.ctx.fieldkit.executeCommand(sessionId, request)).catch(fieldkitRemoteFailure) }
  @Remote('checkConfiguration')
  checkConfiguration(rawRecordText: string): Promise<FieldkitConfigurationCheck> { return Promise.resolve().then(() => this.ctx.fieldkit.checkConfiguration(rawRecordText)).catch(fieldkitRemoteFailure) }
}
