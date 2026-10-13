/** Public Remote DTOs. Nullable owner data is normal in explicit legacy CLI mode. */
export interface FieldkitDescribe {
  readonly mode: 'service-v2' | 'integration' | 'legacy-cli'
  readonly available: boolean
  readonly reason: string | null
  readonly protocol: string | null
  readonly instanceId: string | null
  readonly toolVersion: string | null
  readonly readOnly: true
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
