/** Public Remote DTOs. Nullable owner data is normal in explicit legacy CLI mode. */
export interface FieldkitDescribe {
  readonly mode: 'integration' | 'legacy-cli'
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

export interface FieldkitError { readonly code: string; readonly message: string; readonly action: string | null }

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
  readonly status: 'running' | 'complete' | 'incomplete'
  readonly phase: 'reading' | 'saving' | 'finished' | 'report_failed'
  readonly step: string | null
  readonly complete: boolean
  readonly evidence: readonly FieldkitReadEvidence[]
  readonly error: FieldkitError | null
  readonly reports: { readonly markdown: string; readonly json: string } | null
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
  readonly readiness: { readonly ready: boolean; readonly reasonCode: string | null } | null
  readonly telemetryReceivedAgeMs: string | null
  readonly nativeJsonText: string | null
  readonly receivedAt: string | null
  readonly readRun: FieldkitReadRun | null
}

export interface FieldkitProcessError { readonly message: string; readonly code?: string | number | null }

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
