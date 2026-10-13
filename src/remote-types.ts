/** Public Remote DTOs. Nullable owner data is normal in explicit legacy CLI mode. */
export interface FieldkitDescribe {
  readonly mode: 'service-v2' | 'integration' | 'legacy-cli'
  readonly available: boolean
  readonly reason: string | null
  readonly protocol: string | null
  readonly instanceId: string | null
  readonly toolVersion: string | null
  readonly readOnly: boolean
  readonly capabilities?: readonly string[]
}

export interface FieldkitIdentity { readonly uid: string; readonly runNonce: string }

export interface FieldkitTarget {
  readonly targetId: string
  readonly label: string
  readonly transport: string
  readonly connected: boolean
  readonly identity: FieldkitIdentity | null
  readonly connectionGeneration: string | null
  readonly canAttach: boolean
  readonly canConnect: boolean
}

export interface FieldkitError { readonly code: string; readonly message: string; readonly action: string | null; readonly unknown?: boolean; readonly controlEffect?: FieldkitControlEffect }

export interface FieldkitBinding {
  readonly bindingId: string
  readonly targetId: string
  readonly transport: string
  readonly instanceId: string | null
  readonly connectionGeneration: string | null
  readonly identity: FieldkitIdentity | null
  readonly expired: boolean
  readonly observationWarnings: readonly FieldkitError[]
}

export interface FieldkitTargets {
  readonly mode: FieldkitDescribe['mode']
  readonly instanceId: string | null
  readonly discoveryLimited?: boolean
  readonly discoveryReason?: string | null
  readonly targets: readonly FieldkitTarget[]
  readonly selectedBinding: FieldkitBinding | null
}

export interface FieldkitReadEvidence {
  readonly action: string
  readonly origin?: string
  readonly identity?: FieldkitIdentity | null
  readonly controlEffect?: FieldkitControlEffect
  readonly readPermit?: FieldkitReadPermit
  readonly connectionGeneration?: string
  readonly sourceTimestamp?: FieldkitSourceTimestamp | null
  readonly receivedAgeMs?: string | null
  readonly nativeQuality?: null
  readonly dataUtf8?: string | null
  readonly dataHex?: string
  readonly exitCode?: number | null
  readonly processError?: FieldkitProcessError | null
  readonly parseError?: string
  readonly nativeJsonText?: string | null
  readonly receivedAt?: string | null
  readonly stdout?: string | null
  readonly stderr?: string | null
  readonly error?: FieldkitError | null
}

export interface FieldkitReadRun {
  readonly readRunId: string
  readonly bindingId: string
  readonly targetId: string
  readonly mode: FieldkitDescribe['mode']
  readonly instanceId: string | null
  readonly connectionGeneration: string | null
  readonly identity: FieldkitIdentity | null
  readonly serial?: string
  readonly startedAt: string
  readonly endedAt: string | null
  readonly status: 'running' | 'complete' | 'incomplete'
  readonly phase: 'reading' | 'saving' | 'finished' | 'report_failed'
  readonly step: string | null
  readonly complete: boolean
  readonly evidence: readonly FieldkitReadEvidence[]
  readonly error: FieldkitError | null
  readonly reports: { readonly markdown: string; readonly json: string } | null
  readonly reportError?: { readonly code: string; readonly message: string }
}

export interface FieldkitSnapshot {
  readonly bindingId: string
  readonly targetId: string
  readonly transport: string
  readonly instanceId: string | null
  readonly identity: FieldkitIdentity | null
  readonly connectionGeneration: string | null
  readonly expired: boolean
  readonly observationWarnings: readonly FieldkitError[]
  readonly controlEffect?: FieldkitControlEffect
  readonly readPermit?: FieldkitReadPermit
  readonly readiness: { readonly ready: boolean; readonly reasonCode: string | null } | null
  readonly telemetryReceivedAgeMs: string | null
  readonly nativeJsonText: string | null
  readonly receivedAt: string | null
  readonly readRun: FieldkitReadRun | null
}

export interface FieldkitProcessError {
  readonly name?: string
  readonly message: string
  readonly code?: string | number | null
  readonly signal?: string | null
  readonly killed?: boolean
}
export interface FieldkitReadPermit { readonly ready: boolean; readonly reason_code: string | null }
export interface FieldkitSourceTimestamp { readonly clock: 'device_monotonic_us'; readonly value: string }

export interface FieldkitConfigurationCheck {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error: FieldkitProcessError | null
  readonly summary: string
  readonly issues: readonly string[]
}

export interface FieldkitOpenTargetRequest {
  readonly targetId: string
  readonly intent: 'attach' | 'connect'
  readonly expectedIdentity?: FieldkitIdentity
  readonly connectionGeneration?: string
}
export interface FieldkitBindingRequest { readonly bindingId: string }
export interface FieldkitReadRunRequest { readonly readRunId?: string }
export interface FieldkitCancelReadRunRequest { readonly readRunId: string }

export interface FieldkitService {
  cleanupOriginalScope(sessionId: string, request: FieldkitOriginalCleanupRequest): Promise<FieldkitOriginalStopResult>
  getOriginalScopeOperation(sessionId: string, request: FieldkitOriginalOperationRequest): Promise<FieldkitOriginalStopResult>
  controlCandidates(sessionId: string): Promise<FieldkitControlCandidates>
  createControlScope(sessionId: string, request: FieldkitControlScopeRequest): Promise<FieldkitControlScope>
  selectControlScope(sessionId: string, scopeId: string): Promise<FieldkitControlContext>
  controlContext(sessionId: string): Promise<FieldkitControlContext>
  submitControl(sessionId: string, request: FieldkitControlRequest): Promise<FieldkitControlResult>
  recordControl(sessionId: string, request: FieldkitControlRecordingRequest): Promise<FieldkitControlResult>
  stopControlScope(sessionId: string, scopeId: string): Promise<FieldkitControlResult>
  revokeControlScope(sessionId: string, scopeId: string): Promise<FieldkitControlScope>
  releaseControlScope(sessionId: string, scopeId: string): Promise<FieldkitControlScope>
  startControlTrial(sessionId: string, request: FieldkitTrialStartRequest): Promise<FieldkitTrialReceipt>
  updateControlTrial(sessionId: string, request: FieldkitTrialUpdateRequest): Promise<FieldkitTrialReceipt>
  getControlTrial(sessionId: string, trialId: string): Promise<FieldkitTrialReceipt>
  releaseControlTrial(sessionId: string, trialId: string): Promise<FieldkitTrialReceipt>
  listOriginalStopScopes(sessionId: string): Promise<FieldkitOriginalStopScopes>
  stopOriginalScope(sessionId: string, referenceId: string): Promise<FieldkitOriginalStopResult>
  configurationSchema(sessionId: string): Promise<FieldkitConfigurationSchema>
  validateConfiguration(sessionId: string, rawText: string): Promise<FieldkitConfigurationValidation>
  readConfiguration(sessionId: string, request: FieldkitConfigurationReadRequest): Promise<FieldkitConfigurationRead>
  maintenanceContext(sessionId: string): Promise<FieldkitMaintenanceContext>
  setMaintenancePermission(sessionId: string, request: FieldkitMaintenancePermissionRequest): Promise<FieldkitMaintenanceGrant | null>
  submitMaintenance(sessionId: string, request: FieldkitMaintenanceRequest): Promise<FieldkitMaintenanceReceipt>
  getMaintenanceOperation(sessionId: string, operationId: string): Promise<FieldkitMaintenanceReceipt>

  connectAdvanced(sessionId: string, request: FieldkitAdvancedConnectionRequest): Promise<FieldkitConnectionResult>
  scanAdvanced(sessionId: string, request: FieldkitAdvancedScanRequest): Promise<FieldkitScan>
  scanProfile(sessionId: string, request: FieldkitProfileScanRequest): Promise<FieldkitScan>
  connectScannedNodes(sessionId: string, request: FieldkitBatchConnectionRequest): Promise<FieldkitJob>
  listProfiles(sessionId: string): Promise<FieldkitProfiles>
  saveProfile(sessionId: string, profile: FieldkitProfile): Promise<FieldkitJob>
  deleteProfile(sessionId: string, profileId: string): Promise<FieldkitJob>
  listAdapters(sessionId: string): Promise<FieldkitJob>
  listRecordings(sessionId: string): Promise<FieldkitJob>
  listOdriveDevices(sessionId: string): Promise<FieldkitJob>
  readOdrive(sessionId: string, serial: string): Promise<FieldkitJob>
  getJob(sessionId: string, jobId: string): Promise<FieldkitJob>
  downloadRecording(sessionId: string, request: FieldkitRecordingRequest): Promise<FieldkitJob>
  listConnections(sessionId: string): Promise<FieldkitConnections>
  connectProfile(sessionId: string, profileId: string): Promise<FieldkitConnectionResult>
  changeConnection(sessionId: string, request: FieldkitConnectionChange): Promise<FieldkitConnection>
  startScan(sessionId: string, request: FieldkitScanRequest): Promise<FieldkitScan>
  getScan(sessionId: string, scanId: string): Promise<FieldkitScan>
  getEvents(sessionId: string, after: string): Promise<FieldkitEvents>
  downloadReport(sessionId: string, request: FieldkitReportRequest): Promise<FieldkitDownload>
  serviceStatus(): Promise<FieldkitServiceStatus>
  saveServiceSettings(request: FieldkitServiceSettings): Promise<FieldkitServiceStatus>
  startService(): Promise<FieldkitServiceStatus>
  attachService(): Promise<FieldkitServiceStatus>
  shutdownService(request: FieldkitShutdownRequest): Promise<FieldkitServiceStatus>
  describe(): Promise<FieldkitDescribe>
  listTargets(sessionId: string): Promise<FieldkitTargets>
  openTarget(sessionId: string, request: FieldkitOpenTargetRequest): Promise<FieldkitBinding>
  getSnapshot(sessionId: string, request: FieldkitBindingRequest): Promise<FieldkitSnapshot>
  diagnose(sessionId: string, request: FieldkitBindingRequest): Promise<FieldkitReadRun>
  getReadRun(sessionId: string, request: FieldkitReadRunRequest): Promise<FieldkitReadRun | null>
  cancelReadRun(sessionId: string, request: FieldkitCancelReadRunRequest): Promise<FieldkitReadRun>
  detachTarget(sessionId: string, request: FieldkitBindingRequest): Promise<FieldkitBinding>
  checkConfiguration(rawRecordText: string): Promise<FieldkitConfigurationCheck>
  hasReport(sessionId: string, path: string): Promise<boolean>
}

export interface FieldkitServiceSettings {
  readonly toolPath: string
  readonly port: number
  readonly dataDir: string
  readonly runsDir: string
  readonly odrivePython: string
}
export interface FieldkitShutdownRequest { readonly instanceId: string; readonly confirmation: string }
export interface FieldkitControlEffect { readonly state: 'unknown' | 'not_observed'; readonly reason_code: string | null }
export interface FieldkitServiceInstance {
  readonly instance_id: string
  readonly tool_version: string
  readonly pid: string
  readonly started_at_unix_ms: string
  readonly endpoint: string
  readonly service_state: 'running' | 'shutting_down'
  readonly sessions: readonly { readonly session_id: string; readonly connected: boolean; readonly heartbeat_active: boolean; readonly recording_active: boolean; readonly trial_state: string | null }[]
  readonly activity: { readonly trial_active: boolean; readonly trial_unresolved: boolean; readonly read_blocker: string | null }
  readonly control_effect: FieldkitControlEffect
  readonly device_stop_requested: false
  readonly accepted?: boolean
}
export interface FieldkitServiceStatus {
  readonly settings: FieldkitServiceSettings
  readonly attached: boolean
  readonly instance: FieldkitServiceInstance | null
  readonly error: { readonly code: string; readonly message: string } | null
}

export type FieldkitProfile = FieldkitCanProfile | FieldkitUsbProfile
export interface FieldkitUsbProfile { readonly transport: 'usb'; readonly id: string; readonly name: string; readonly serial: string; readonly expectedUid: string | null }
export interface FieldkitCanProfile { readonly transport?: 'can'; readonly id: string; readonly name: string; readonly adapter: { readonly kind: 'canable2'; readonly serial: string }; readonly node: number; readonly mode: 'fd'; readonly expectedUid: string | null }
export interface FieldkitProfiles { readonly profiles: readonly FieldkitProfile[]; readonly loadError: string | null; readonly busy: boolean }
export interface FieldkitConnection { readonly connectionId: string; readonly targetId: string; readonly identity: FieldkitIdentity | null; readonly connectionGeneration: string; readonly connected: boolean; readonly snapshotJsonText: string; readonly telemetryReceivedAgeMs: string | null; readonly profileJobId: string | null }
export interface FieldkitConnectionChange { readonly connectionId: string; readonly identity: FieldkitIdentity | null; readonly connectionGeneration: string; readonly action: 'disconnect' | 'reconnect' }
export interface FieldkitScanRequest { readonly connectionId: string; readonly identity: FieldkitIdentity; readonly connectionGeneration: string; readonly nodes: readonly number[] }
export interface FieldkitScan { readonly scanId: string; readonly state: 'running' | 'completed'; readonly nodes: readonly { readonly node: number; readonly identity: FieldkitIdentity }[]; readonly errors: readonly { readonly node: number; readonly message: string; readonly unknown: boolean; readonly errorJsonText: string | null }[] }
export interface FieldkitRecordingRequest { readonly runId: string; readonly file: 'metadata.json' | 'events.jsonl' | 'telemetry.csv'; readonly offset: string }
export interface FieldkitRecording { readonly id: string; readonly metadataJsonText: string | null; readonly files: readonly string[] }
export interface FieldkitJob {
  readonly jobId: string
  readonly kind: 'adapters' | 'recordings' | 'download' | 'profileSave' | 'profileDelete' | 'odriveDevices' | 'odriveRead' | 'batchConnect' | 'connect'
  readonly state: 'queued' | 'running' | 'completed' | 'failed'
  readonly error: string | null
  readonly adapters?: readonly { readonly kind: string; readonly serial: string; readonly description: string; readonly vid: number | null; readonly pid: number | null }[]
  readonly recordings?: readonly FieldkitRecording[]
  readonly truncated?: boolean
  readonly connection?: FieldkitConnection
  readonly batch?: FieldkitBatchConnections
  readonly profile?: FieldkitProfile
  readonly deletedId?: string
  readonly nativeJsonText?: string
  readonly download?: { readonly runId: string; readonly file: string; readonly offset: string; readonly nextOffset: string; readonly eof: boolean; readonly contentBase64: string }
}
export interface FieldkitEvent {
  readonly cursor: string
  readonly kind: 'connection' | 'telemetry' | 'source_gap' | 'scan' | 'job'
  readonly sourceId: string
  readonly sourceTimestamp: { readonly clock: 'device_monotonic_us' | 'host_unix_ms'; readonly value: string }
  readonly receivedAt: string
  readonly gap: boolean
  readonly sourceGap: { readonly reason: string; readonly dropped: string | null } | null
  readonly targetId?: string
  readonly identity?: FieldkitIdentity | null
  readonly connectionGeneration?: string
  readonly connected?: boolean
  readonly nativeJsonText?: string
  readonly scanId?: string
  readonly jobId?: string
  readonly state?: string
}
export interface FieldkitEvents { readonly cursor: string; readonly gap: boolean; readonly gapReasons: readonly string[]; readonly lostRanges: readonly { readonly firstCursor: string; readonly lastCursor: string; readonly count: string }[]; readonly truncated: boolean; readonly events: readonly FieldkitEvent[] }
export interface FieldkitReportRequest { readonly readRunId: string; readonly format: 'markdown' | 'json' }
export interface FieldkitDownload { readonly filename: string; readonly mime: string; readonly content: string }

export interface FieldkitConnections { readonly connections: readonly FieldkitConnection[] }

export interface FieldkitAdvancedCan { readonly channel: string; readonly mode: 'classic' | 'fd'; readonly python: string | null }
export interface FieldkitAdvancedConnectionRequest { readonly channel: string; readonly mode: 'classic' | 'fd'; readonly python: string | null; readonly node: number }
export interface FieldkitAdvancedScanRequest { readonly advanced: FieldkitAdvancedCan; readonly nodes: readonly number[] }
export interface FieldkitProfileScanRequest { readonly profileId: string; readonly nodes: readonly number[] }
export interface FieldkitBatchConnectionRequest { readonly scanId: string; readonly nodes: readonly number[] }
export interface FieldkitBatchConnections { readonly connections: readonly FieldkitConnection[]; readonly errors: readonly { readonly node: number; readonly targetId: string; readonly code: string; readonly message: string; readonly unknown: boolean; readonly errorJsonText: string | null }[] }

export type FieldkitConnectionResult = FieldkitConnection | FieldkitJob

export interface FieldkitMaintenanceTarget {
  readonly instanceId: string
  readonly bindingId: string
  readonly targetId: string
  readonly uid: string
  readonly runNonce: string
  readonly connectionGeneration: string
}
export type FieldkitMaintenanceAction = 'save_and_restart' | 'restore_factory_and_restart' | 'reset_application' | 'enter_update'
export interface FieldkitMaintenanceGrant { readonly grantId: string; readonly target: FieldkitMaintenanceTarget; readonly maintenance: true }
export interface FieldkitMaintenancePermissionRequest { readonly target: FieldkitMaintenanceTarget; readonly enabled: boolean }
export interface FieldkitMaintenanceRequest { readonly grantId: string; readonly action: FieldkitMaintenanceAction; readonly rawRecordText?: string }
export interface FieldkitMaintenanceError { readonly code: string; readonly message: string }
export interface FieldkitMaintenanceFollowUp { readonly reconnectRequired: boolean; readonly readbackViews: readonly ('user' | 'startup')[] }
export interface FieldkitMaintenanceReceipt {
  readonly operationId: string
  readonly grantId: string
  readonly target: FieldkitMaintenanceTarget
  readonly action: FieldkitMaintenanceAction
  readonly admission: 'queued' | 'attempting' | 'finished'
  readonly submission: 'not_attempted' | 'not_submitted' | 'locally_submitted' | 'unknown'
  readonly controlEffect: 'not_attempted' | 'not_applicable' | 'unresolved'
  readonly observation: 'unconfirmed'
  readonly phase: 'factory_read' | 'submission' | null
  readonly unknown: boolean
  readonly unknownSource?: 'transport' | 'sdk' | null
  readonly nativeJsonText: string | null
  readonly followUp: FieldkitMaintenanceFollowUp
  readonly error: FieldkitMaintenanceError | null
  readonly newSubmission?: boolean
}
export interface FieldkitMaintenanceContext { readonly target: FieldkitMaintenanceTarget | null; readonly grant: FieldkitMaintenanceGrant | null; readonly latestOperation: FieldkitMaintenanceReceipt | null }
export interface FieldkitConfigurationSchema { readonly nativeJsonText: string; readonly configFormatVersion: number }
export interface FieldkitConfigurationValidation { readonly valid: true }
export interface FieldkitConfigurationReadRequest { readonly bindingId: string; readonly view: 'factory' | 'startup' | 'user' }
export interface FieldkitConfigurationRead { readonly view: 'factory' | 'startup' | 'user'; readonly target: FieldkitMaintenanceTarget; readonly nativeJsonText: string; readonly dataUtf8: string | null; readonly dataHex: string }

export interface FieldkitControlCandidate { readonly candidateId: string; readonly label: string; readonly targetId: string; readonly instanceId: string; readonly uid: string; readonly runNonce: string; readonly connectionGeneration: string }
export interface FieldkitControlCandidates { readonly candidates: readonly FieldkitControlCandidate[] }
export interface FieldkitControlMember { readonly target: FieldkitMaintenanceTarget; readonly grantId: string }
export interface FieldkitControlMemberResult {
  readonly previousOperationId?: string | null
  readonly previousSubmission?: string
  readonly previousUnknown?: boolean
  readonly previousNativeJsonText?: string | null
  readonly target: FieldkitMaintenanceTarget
  readonly operationId: string | null
  readonly admission: string
  readonly submission: string
  readonly controlEffect: string
  readonly observation: string
  readonly phase: string | null
  readonly unknown: boolean
  readonly unknownSource: 'transport' | 'sdk' | null
  readonly nativeJsonText: string | null
  readonly error: FieldkitMaintenanceError | null
  readonly stopAttemptDelayMs?: string | null
  readonly trialId?: string | null
  readonly recordingId?: string | null
}
export interface FieldkitControlResult { readonly scopeId: string; readonly action: string; readonly results: readonly FieldkitControlMemberResult[]; readonly unknown: boolean; readonly newSubmission?: boolean; readonly coalescedExisting?: boolean }
export interface FieldkitControlRecordingStatus { readonly target: FieldkitMaintenanceTarget; readonly active: boolean | null; readonly failed: boolean | null; readonly recordingId: string | null; readonly nativeJsonText: string | null; readonly error: FieldkitMaintenanceError | null }
export interface FieldkitControlScope { readonly controlGranted?: boolean; readonly lastOrdinary?: FieldkitControlResult | null; readonly recordings?: readonly FieldkitControlRecordingStatus[]; readonly scopeId: string; readonly instanceId: string; readonly members: readonly FieldkitControlMember[]; readonly kind: 'single' | 'group'; readonly state: 'active' | 'released' | 'expired'; readonly controlReady: boolean; readonly reason: string | null; readonly stopAvailable: boolean; readonly stopReason: string | null; readonly latest: FieldkitControlResult | null; readonly trial: FieldkitTrialReceipt | null }
export interface FieldkitControlContext { readonly scopes: readonly FieldkitControlScope[]; readonly activeScopeId: string | null; readonly capabilities: readonly string[] }
export interface FieldkitControlScopeRequest { readonly candidateIds: readonly string[] }
export type FieldkitControlCommand = { readonly action: 'position'; readonly mm: string } | { readonly action: 'velocity'; readonly mm_s: string } | { readonly action: 'force'; readonly n: string } | { readonly action: 'impedance'; readonly equilibrium_mm: string; readonly stiffness_n_per_mm: string; readonly damping_ns_per_mm: string } | { readonly action: 'heartbeat_start' | 'heartbeat_stop' | 'heartbeat_once' }
export interface FieldkitControlRequest { readonly scopeId: string; readonly command: FieldkitControlCommand }
export interface FieldkitControlRecordingRequest { readonly scopeId: string; readonly action: 'start' | 'stop' }
export interface FieldkitTrialParameters {
  readonly mode: 'position' | 'velocity' | 'force' | 'impedance'
  readonly command: { readonly positionMm: string; readonly velocityMmS: string; readonly forceN: string; readonly equilibriumMm: string; readonly stiffnessNPerMm: string; readonly dampingNsPerMm: string }
  readonly envelope: { readonly positionMinMm: string; readonly positionMaxMm: string; readonly velocityAbsMaxMmS: string; readonly forceAbsMaxN: string; readonly stiffnessMaxNPerMm: string; readonly dampingMaxNsPerMm: string; readonly durationMaxS: string }
  readonly durationS: string
  readonly reach: { readonly toleranceMm: string; readonly settleMs: string } | null
}
export interface FieldkitTrialStartRequest { readonly scopeId: string; readonly parameters: FieldkitTrialParameters }
export interface FieldkitTrialUpdateRequest { readonly trialId: string; readonly positionRaw: string }
export interface FieldkitTrialMemberResult { readonly trialState?: string; readonly stopObserved?: boolean; readonly stopConfirmationOverdue?: boolean; readonly elapsedMs?: string | null; readonly trialNativeJsonText?: string; readonly operationId?: string | null; readonly unknownSource?: 'transport' | 'sdk' | null; readonly controlEffect?: string | null; readonly target: FieldkitMaintenanceTarget; readonly preparation: string; readonly admission: string; readonly submission: string; readonly observation: string | null; readonly unknown: boolean; readonly nativeJsonText?: string | null }
export interface FieldkitTrialReceipt { readonly trialId: string | null; readonly members: readonly FieldkitMaintenanceTarget[]; readonly mode: 'position' | 'velocity' | 'force' | 'impedance'; readonly state: string; readonly progress: readonly string[]; readonly results: readonly FieldkitTrialMemberResult[]; readonly unknown: boolean; readonly stopAvailable: boolean; readonly recordingIds: readonly string[]; readonly newSubmission?: boolean; readonly coalescedExisting?: boolean }

export interface FieldkitOriginalStopScope { readonly referenceId: string; readonly targetId: string; readonly uid: string; readonly runNonce: string; readonly connectionGeneration: string; readonly controlEpoch: string; readonly instanceId: string; readonly current: boolean; readonly controlGranted: boolean; readonly stopRequestId: string }
export interface FieldkitOriginalStopScopes { readonly scopes: readonly FieldkitOriginalStopScope[] }
export interface FieldkitOriginalStopResult { readonly action?: string; readonly referenceId: string; readonly scope: FieldkitOriginalStopScope; readonly operationId: string; readonly admission: string; readonly submission: string; readonly controlEffect: string; readonly observation: string; readonly unknown: boolean; readonly unknownSource: 'transport' | 'sdk' | null; readonly nativeJsonText: string | null; readonly error: FieldkitMaintenanceError | null; readonly newSubmission?: boolean }

export interface FieldkitOriginalCleanupRequest { readonly referenceId: string; readonly action: 'heartbeat_stop' | 'recording_stop' }
export interface FieldkitOriginalOperationRequest { readonly referenceId: string; readonly operationId: string; readonly action?: 'stop' | 'heartbeat_stop' | 'recording_stop' }
