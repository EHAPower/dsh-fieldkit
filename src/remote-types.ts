export interface FieldkitTargetContext {
  readonly transport: 'usb' | 'can'
  readonly node: number | null
  readonly label: string
}

export interface FieldkitCommandRequest {
  readonly command: string
  /** Original JSON request text. The plugin validates it but never serializes it again. */
  readonly bodyText: string
  /** URLSearchParams text for the fixed command route. */
  readonly queryText: string
}

export interface FieldkitCommandResult {
  readonly command: string
  readonly method: string
  readonly path: string
  /** HTTP result only; it is not a claim about device completion. */
  readonly status: number
  readonly ok: boolean
  /** Exact UTF-8 response text returned by eha-tool, including error responses. */
  readonly bodyText: string
  readonly receivedAt: string
}

export interface FieldkitServiceSettings {
  readonly toolPath: string
  readonly port: number
  readonly dataDir: string
  readonly runsDir: string
  readonly odrivePython: string
}

export interface FieldkitServiceStatus {
  readonly settings: FieldkitServiceSettings
  readonly attached: boolean
  readonly description: { readonly instance_id: string; readonly capabilities: readonly string[] } | null
  readonly instance: FieldkitServiceInstance | null
  readonly error: { readonly code: string; readonly message: string } | null
}

export interface FieldkitServiceInstance {
  readonly instance_id: string
  readonly endpoint: string
  readonly pid: string
  readonly started_at_unix_ms: string
  readonly tool_version: string
  readonly service_state: string
}

export interface FieldkitDescribe {
  readonly available: boolean
  readonly capabilities: readonly string[]
  readonly instanceId: string | null
}

export interface FieldkitContext {
  readonly target: FieldkitTargetContext | null
  /** Latest direct-api reply for this chat only; it is not persisted or replayed. */
  readonly lastResult: FieldkitCommandResult | null
}
export interface FieldkitShutdownRequest { readonly instanceId: string }
export interface FieldkitConfigurationCheck {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error: { readonly name: string; readonly message: string; readonly code: string | number | null; readonly signal: string | null; readonly killed: boolean } | null
}

export interface FieldkitService {
  serviceStatus(): Promise<FieldkitServiceStatus>
  saveServiceSettings(request: FieldkitServiceSettings): Promise<FieldkitServiceStatus>
  startService(): Promise<FieldkitServiceStatus>
  attachService(): Promise<FieldkitServiceStatus>
  shutdownService(request: FieldkitShutdownRequest): Promise<FieldkitServiceStatus>
  describe(): Promise<FieldkitDescribe>
  selectTarget(sessionId: string, request: FieldkitTargetContext): Promise<FieldkitContext>
  context(sessionId: string): Promise<FieldkitContext>
  executeCommand(sessionId: string, request: FieldkitCommandRequest): Promise<FieldkitCommandResult>
  checkConfiguration(rawRecordText: string): Promise<FieldkitConfigurationCheck>
}
