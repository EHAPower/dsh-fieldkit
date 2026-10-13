import type { FieldkitOriginalCleanupRequest, FieldkitOriginalOperationRequest } from './remote-types.js'
import type { FieldkitControlCandidates, FieldkitControlContext, FieldkitControlRecordingRequest, FieldkitControlRequest, FieldkitControlResult, FieldkitControlScope, FieldkitControlScopeRequest, FieldkitOriginalStopResult, FieldkitOriginalStopScopes, FieldkitTrialReceipt, FieldkitTrialStartRequest, FieldkitTrialUpdateRequest } from './remote-types.js'
import type { FieldkitConfigurationSchema, FieldkitConfigurationValidation, FieldkitConfigurationReadRequest, FieldkitConfigurationRead, FieldkitMaintenanceContext, FieldkitMaintenancePermissionRequest, FieldkitMaintenanceGrant, FieldkitMaintenanceRequest, FieldkitMaintenanceReceipt } from './remote-types.js'
import type { FieldkitAdvancedConnectionRequest, FieldkitAdvancedScanRequest, FieldkitProfileScanRequest, FieldkitBatchConnectionRequest } from './remote-types.js'
import type { FieldkitConnectionResult, FieldkitConnections, FieldkitProfiles, FieldkitProfile, FieldkitJob, FieldkitRecordingRequest, FieldkitConnection, FieldkitConnectionChange, FieldkitScanRequest, FieldkitScan, FieldkitEvents, FieldkitReportRequest, FieldkitDownload } from './remote-types.js'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  FieldkitServiceStatus,
  FieldkitServiceSettings,
  FieldkitShutdownRequest,
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


declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap { 'fieldkit/service': { readonly code: string; readonly unknown: boolean | null } }
}
export function fieldkitRemoteFailure(error: unknown): never {
  const value = error as { code?: unknown; message?: unknown; unknown?: unknown }
  const code = typeof value?.code === 'string' ? value.code : 'backend_error'
  const message = code === 'owner_busy' ? '物理通路已被另一个 owner 占用；请附着已有服务，或先在原 owner 明确释放连接。' : typeof value?.message === 'string' ? value.message : '服务请求失败。'
  throw new RemoteError('fieldkit/service', message, { code, unknown: typeof value?.unknown === 'boolean' ? value.unknown : null })
}

export class FieldkitRemote extends TypertRemoteService {
  static inject = ['fieldkit']

  constructor(ctx: Context) {
    super(ctx, 'fieldkitRemote', { namespace: 'fieldkit' })
  }

  @Remote('controlCandidates')
  controlCandidates(sessionId: string): Promise<FieldkitControlCandidates> { return Promise.resolve().then(() => this.ctx.fieldkit.controlCandidates(sessionId)).catch(fieldkitRemoteFailure) }

  @Remote('createControlScope')
  createControlScope(sessionId: string, request: FieldkitControlScopeRequest): Promise<FieldkitControlScope> { return Promise.resolve().then(() => this.ctx.fieldkit.createControlScope(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('selectControlScope')
  selectControlScope(sessionId: string, scopeId: string): Promise<FieldkitControlContext> { return Promise.resolve().then(() => this.ctx.fieldkit.selectControlScope(sessionId, scopeId)).catch(fieldkitRemoteFailure) }

  @Remote('controlContext')
  controlContext(sessionId: string): Promise<FieldkitControlContext> { return Promise.resolve().then(() => this.ctx.fieldkit.controlContext(sessionId)).catch(fieldkitRemoteFailure) }

  @Remote('submitControl')
  submitControl(sessionId: string, request: FieldkitControlRequest): Promise<FieldkitControlResult> { return Promise.resolve().then(() => this.ctx.fieldkit.submitControl(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('recordControl')
  recordControl(sessionId: string, request: FieldkitControlRecordingRequest): Promise<FieldkitControlResult> { return Promise.resolve().then(() => this.ctx.fieldkit.recordControl(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('stopControlScope')
  stopControlScope(sessionId: string, scopeId: string): Promise<FieldkitControlResult> { return Promise.resolve().then(() => this.ctx.fieldkit.stopControlScope(sessionId, scopeId)).catch(fieldkitRemoteFailure) }

  @Remote('revokeControlScope')
  revokeControlScope(sessionId: string, scopeId: string): Promise<FieldkitControlScope> { return Promise.resolve().then(() => this.ctx.fieldkit.revokeControlScope(sessionId, scopeId)).catch(fieldkitRemoteFailure) }

  @Remote('releaseControlScope')
  releaseControlScope(sessionId: string, scopeId: string): Promise<FieldkitControlScope> { return Promise.resolve().then(() => this.ctx.fieldkit.releaseControlScope(sessionId, scopeId)).catch(fieldkitRemoteFailure) }

  @Remote('startControlTrial')
  startControlTrial(sessionId: string, request: FieldkitTrialStartRequest): Promise<FieldkitTrialReceipt> { return Promise.resolve().then(() => this.ctx.fieldkit.startControlTrial(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('updateControlTrial')
  updateControlTrial(sessionId: string, request: FieldkitTrialUpdateRequest): Promise<FieldkitTrialReceipt> { return Promise.resolve().then(() => this.ctx.fieldkit.updateControlTrial(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('getControlTrial')
  getControlTrial(sessionId: string, trialId: string): Promise<FieldkitTrialReceipt> { return Promise.resolve().then(() => this.ctx.fieldkit.getControlTrial(sessionId, trialId)).catch(fieldkitRemoteFailure) }

  @Remote('releaseControlTrial')
  releaseControlTrial(sessionId: string, trialId: string): Promise<FieldkitTrialReceipt> { return Promise.resolve().then(() => this.ctx.fieldkit.releaseControlTrial(sessionId, trialId)).catch(fieldkitRemoteFailure) }

  @Remote('listOriginalStopScopes')
  listOriginalStopScopes(sessionId: string): Promise<FieldkitOriginalStopScopes> { return Promise.resolve().then(() => this.ctx.fieldkit.listOriginalStopScopes(sessionId)).catch(fieldkitRemoteFailure) }

  @Remote('stopOriginalScope')
  stopOriginalScope(sessionId: string, referenceId: string): Promise<FieldkitOriginalStopResult> { return Promise.resolve().then(() => this.ctx.fieldkit.stopOriginalScope(sessionId, referenceId)).catch(fieldkitRemoteFailure) }

  @Remote('cleanupOriginalScope')
  cleanupOriginalScope(sessionId: string, request: FieldkitOriginalCleanupRequest): Promise<FieldkitOriginalStopResult> { return Promise.resolve().then(() => this.ctx.fieldkit.cleanupOriginalScope(sessionId, request)).catch(fieldkitRemoteFailure) }
  @Remote('getOriginalScopeOperation')
  getOriginalScopeOperation(sessionId: string, request: FieldkitOriginalOperationRequest): Promise<FieldkitOriginalStopResult> { return Promise.resolve().then(() => this.ctx.fieldkit.getOriginalScopeOperation(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('configurationSchema')
  configurationSchema(sessionId: string): Promise<FieldkitConfigurationSchema> { return Promise.resolve().then(() => this.ctx.fieldkit.configurationSchema(sessionId)).catch(fieldkitRemoteFailure) }

  @Remote('validateConfiguration')
  validateConfiguration(sessionId: string, rawText: string): Promise<FieldkitConfigurationValidation> { return Promise.resolve().then(() => this.ctx.fieldkit.validateConfiguration(sessionId, rawText)).catch(fieldkitRemoteFailure) }

  @Remote('readConfiguration')
  readConfiguration(sessionId: string, request: FieldkitConfigurationReadRequest): Promise<FieldkitConfigurationRead> { return Promise.resolve().then(() => this.ctx.fieldkit.readConfiguration(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('maintenanceContext')
  maintenanceContext(sessionId: string): Promise<FieldkitMaintenanceContext> { return Promise.resolve().then(() => this.ctx.fieldkit.maintenanceContext(sessionId)).catch(fieldkitRemoteFailure) }

  @Remote('setMaintenancePermission')
  setMaintenancePermission(sessionId: string, request: FieldkitMaintenancePermissionRequest): Promise<FieldkitMaintenanceGrant | null> { return Promise.resolve().then(() => this.ctx.fieldkit.setMaintenancePermission(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('submitMaintenance')
  submitMaintenance(sessionId: string, request: FieldkitMaintenanceRequest): Promise<FieldkitMaintenanceReceipt> { return Promise.resolve().then(() => this.ctx.fieldkit.submitMaintenance(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('getMaintenanceOperation')
  getMaintenanceOperation(sessionId: string, operationId: string): Promise<FieldkitMaintenanceReceipt> { return Promise.resolve().then(() => this.ctx.fieldkit.getMaintenanceOperation(sessionId, operationId)).catch(fieldkitRemoteFailure) }

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

  @Remote('listTargets')
  listTargets(sessionId: string): Promise<FieldkitTargets> { return Promise.resolve().then(() => this.ctx.fieldkit.listTargets(sessionId)).catch(fieldkitRemoteFailure) }

  @Remote('openTarget')
  openTarget(sessionId: string, request: FieldkitOpenTargetRequest): Promise<FieldkitBinding> { return Promise.resolve().then(() => this.ctx.fieldkit.openTarget(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('getSnapshot')
  getSnapshot(sessionId: string, request: FieldkitBindingRequest): Promise<FieldkitSnapshot> { return Promise.resolve().then(() => this.ctx.fieldkit.getSnapshot(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('diagnose')
  diagnose(sessionId: string, request: FieldkitBindingRequest): Promise<FieldkitReadRun> { return Promise.resolve().then(() => this.ctx.fieldkit.diagnose(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('getReadRun')
  getReadRun(sessionId: string, request: FieldkitReadRunRequest): Promise<FieldkitReadRun | null> { return Promise.resolve().then(() => this.ctx.fieldkit.getReadRun(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('cancelReadRun')
  cancelReadRun(sessionId: string, request: FieldkitCancelReadRunRequest): Promise<FieldkitReadRun> { return Promise.resolve().then(() => this.ctx.fieldkit.cancelReadRun(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('detachTarget')
  detachTarget(sessionId: string, request: FieldkitBindingRequest): Promise<FieldkitBinding> { return Promise.resolve().then(() => this.ctx.fieldkit.detachTarget(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('checkConfiguration')
  checkConfiguration(rawRecordText: string): Promise<FieldkitConfigurationCheck> { return Promise.resolve().then(() => this.ctx.fieldkit.checkConfiguration(rawRecordText)).catch(fieldkitRemoteFailure) }

  @Remote('hasReport')
  hasReport(sessionId: string, path: string): Promise<boolean> { return Promise.resolve().then(() => this.ctx.fieldkit.hasReport(sessionId, path)).catch(fieldkitRemoteFailure) }
  @Remote('listProfiles')
  listProfiles(sessionId: string): Promise<FieldkitProfiles> { return Promise.resolve().then(() => this.ctx.fieldkit.listProfiles(sessionId)).catch(fieldkitRemoteFailure) }

  @Remote('saveProfile')
  saveProfile(sessionId: string, profile: FieldkitProfile): Promise<FieldkitJob> { return Promise.resolve().then(() => this.ctx.fieldkit.saveProfile(sessionId, profile)).catch(fieldkitRemoteFailure) }

  @Remote('deleteProfile')
  deleteProfile(sessionId: string, profileId: string): Promise<FieldkitJob> { return Promise.resolve().then(() => this.ctx.fieldkit.deleteProfile(sessionId, profileId)).catch(fieldkitRemoteFailure) }

  @Remote('listAdapters')
  listAdapters(sessionId: string): Promise<FieldkitJob> { return Promise.resolve().then(() => this.ctx.fieldkit.listAdapters(sessionId)).catch(fieldkitRemoteFailure) }

  @Remote('listRecordings')
  listRecordings(sessionId: string): Promise<FieldkitJob> { return Promise.resolve().then(() => this.ctx.fieldkit.listRecordings(sessionId)).catch(fieldkitRemoteFailure) }

  @Remote('listOdriveDevices')
  listOdriveDevices(sessionId: string): Promise<FieldkitJob> { return Promise.resolve().then(() => this.ctx.fieldkit.listOdriveDevices(sessionId)).catch(fieldkitRemoteFailure) }

  @Remote('readOdrive')
  readOdrive(sessionId: string, serial: string): Promise<FieldkitJob> { return Promise.resolve().then(() => this.ctx.fieldkit.readOdrive(sessionId, serial)).catch(fieldkitRemoteFailure) }

  @Remote('getJob')
  getJob(sessionId: string, jobId: string): Promise<FieldkitJob> { return Promise.resolve().then(() => this.ctx.fieldkit.getJob(sessionId, jobId)).catch(fieldkitRemoteFailure) }

  @Remote('downloadRecording')
  downloadRecording(sessionId: string, request: FieldkitRecordingRequest): Promise<FieldkitJob> { return Promise.resolve().then(() => this.ctx.fieldkit.downloadRecording(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('listConnections')
  listConnections(sessionId: string): Promise<FieldkitConnections> { return Promise.resolve().then(() => this.ctx.fieldkit.listConnections(sessionId)).catch(fieldkitRemoteFailure) }

  @Remote('connectProfile')
  connectProfile(sessionId: string, profileId: string): Promise<FieldkitConnectionResult> { return Promise.resolve().then(() => this.ctx.fieldkit.connectProfile(sessionId, profileId)).catch(fieldkitRemoteFailure) }

  @Remote('changeConnection')
  changeConnection(sessionId: string, request: FieldkitConnectionChange): Promise<FieldkitConnection> { return Promise.resolve().then(() => this.ctx.fieldkit.changeConnection(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('startScan')
  startScan(sessionId: string, request: FieldkitScanRequest): Promise<FieldkitScan> { return Promise.resolve().then(() => this.ctx.fieldkit.startScan(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('getScan')
  getScan(sessionId: string, scanId: string): Promise<FieldkitScan> { return Promise.resolve().then(() => this.ctx.fieldkit.getScan(sessionId, scanId)).catch(fieldkitRemoteFailure) }

  @Remote('getEvents')
  getEvents(sessionId: string, after: string): Promise<FieldkitEvents> { return Promise.resolve().then(() => this.ctx.fieldkit.getEvents(sessionId, after)).catch(fieldkitRemoteFailure) }

  @Remote('downloadReport')
  downloadReport(sessionId: string, request: FieldkitReportRequest): Promise<FieldkitDownload> { return Promise.resolve().then(() => this.ctx.fieldkit.downloadReport(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('connectAdvanced')
  connectAdvanced(sessionId: string, request: FieldkitAdvancedConnectionRequest): Promise<FieldkitConnectionResult> { return Promise.resolve().then(() => this.ctx.fieldkit.connectAdvanced(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('scanAdvanced')
  scanAdvanced(sessionId: string, request: FieldkitAdvancedScanRequest): Promise<FieldkitScan> { return Promise.resolve().then(() => this.ctx.fieldkit.scanAdvanced(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('scanProfile')
  scanProfile(sessionId: string, request: FieldkitProfileScanRequest): Promise<FieldkitScan> { return Promise.resolve().then(() => this.ctx.fieldkit.scanProfile(sessionId, request)).catch(fieldkitRemoteFailure) }

  @Remote('connectScannedNodes')
  connectScannedNodes(sessionId: string, request: FieldkitBatchConnectionRequest): Promise<FieldkitJob> { return Promise.resolve().then(() => this.ctx.fieldkit.connectScannedNodes(sessionId, request)).catch(fieldkitRemoteFailure) }

}
