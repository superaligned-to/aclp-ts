/**
 * Validates standard invocations and reply envelopes. Generic envelope definitions classify a message before method lookup; installed result schemas narrow success results, and the protocol document defines the semantic checks schemas cannot express.
 */
export type ACLPStandardMessages = StandardInvocation | SuccessResponse | ErrorResponse | DiscoveryDocument;
export type StandardInvocation = InvocationEnvelope &
  (
    | {
        method: "session.started";
        params: SessionStartedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "session.ended";
        params: SessionEndedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "input.submitted";
        params: InputSubmittedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "run.started";
        params: RunStartedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "run.finishing";
        params: RunFinishingParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "run.finished";
        params: RunFinishedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "tool.requested";
        params: ToolRequestedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "tool.started";
        params: ToolStartedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "tool.finished";
        params: ToolFinishedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "context.compaction.requested";
        params: ContextCompactionRequestedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "context.compaction.finished";
        params: ContextCompactionFinishedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "context.source.loaded";
        params: ContextSourceLoadedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "catalog.changed";
        params: CatalogChangedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "model.requested";
        params: ModelRequestedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "model.finished";
        params: ModelFinishedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "permission.requested";
        params: PermissionRequestedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "permission.resolved";
        params: PermissionResolvedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "interaction.requested";
        params: InteractionRequestedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "interaction.resolved";
        params: InteractionResolvedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "agent.requested";
        params: AgentRequestedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "agent.started";
        params: AgentStartedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "agent.finished";
        params: AgentFinishedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "handoff.requested";
        params: HandoffRequestedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "handoff.finished";
        params: HandoffFinishedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "message.emitting";
        params: MessageEmittingParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "message.emitted";
        params: MessageEmittedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "run.cancellation.requested";
        params: RunCancellationRequestedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "run.paused";
        params: RunPausedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "run.resumed";
        params: RunResumedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "tool.batch.finished";
        params: ToolBatchFinishedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "plan.updated";
        params: PlanUpdatedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "task.created";
        params: TaskCreatedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "task.updated";
        params: TaskUpdatedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "task.finished";
        params: TaskFinishedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "workspace.changed";
        params: WorkspaceChangedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "resource.changed";
        params: ResourceChangedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "configuration.changed";
        params: ConfigurationChangedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "model.changed";
        params: ModelChangedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "notification.created";
        params: NotificationCreatedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "error.occurred";
        params: ErrorOccurredParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "client.registered";
        params: ClientRegisteredParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "client.updated";
        params: ClientUpdatedParams;
        [k: string]: unknown | undefined;
      }
    | {
        method: "client.unregistered";
        params: ClientUnregisteredParams;
        [k: string]: unknown | undefined;
      }
  );
export type InvocationEnvelope = RequestEnvelope | NotificationEnvelope;
export type RequestId = string;
export type Id = string;
export type Text = string;
export type InputSubmittedParams = InputSubmittedParams1 & {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  content: ContentBlock[];
  structuredContent?: JsonValue;
};
export type InputSubmittedParams1 =
  | {
      content?: {
        [k: string]: unknown | undefined;
      };
      [k: string]: unknown | undefined;
    }
  | {
      [k: string]: unknown | undefined;
    };
export type ContentBlock = TextContent | ImageContent | AudioContent | ResourceLinkContent | ResourceContent;
export type Base64 = string;
export type MimeType = string;
export type Uri = string;
export type NonemptyText = string;
export type EmbeddedResource =
  | {
      uri: Uri;
      mimeType?: MimeType;
      text: Text;
    }
  | {
      uri: Uri;
      mimeType?: MimeType;
      blob: Base64;
    };
export type JsonValue = unknown;
export type InputPayload = InputPayload1 & {
  content: ContentBlock[];
  structuredContent?: JsonValue;
};
export type InputPayload1 =
  | {
      content?: {
        [k: string]: unknown | undefined;
      };
      [k: string]: unknown | undefined;
    }
  | {
      [k: string]: unknown | undefined;
    };
export type RunCompletion =
  | {
      status: "succeeded";
      output?: Payload;
    }
  | {
      status: "failed";
      error?: Failure;
      output?: Payload;
    }
  | {
      status: "cancelled";
      reason?: Text;
      output?: Payload;
    }
  | {
      status: "interrupted";
      reason: NonemptyText;
      output?: Payload;
    };
export type ToolCompletion =
  | {
      status: "succeeded";
      output?: Payload;
    }
  | {
      status: "failed";
      error?: Failure;
      output?: Payload;
    }
  | {
      status: "cancelled";
      reason?: Text;
      output?: Payload;
    }
  | {
      status: "denied";
      reason?: Text;
    }
  | {
      status: "unknown";
      reason?: Text;
      output?: Payload;
    };
export type Completion =
  | {
      status: "succeeded";
      output?: Payload;
    }
  | {
      status: "failed";
      error?: Failure;
      output?: Payload;
    }
  | {
      status: "cancelled";
      reason?: Text;
      output?: Payload;
    };
export type CatalogChangedParams = {
  sessionId?: Id;
  runId?: Id;
  agentId?: Id;
  catalog: "tools" | "skills";
  entries: unknown[];
} & CatalogChangedParams1;
export type CatalogChangedParams1 =
  | {
      catalog?: "tools";
      entries?: ToolDefinition[];
      [k: string]: unknown | undefined;
    }
  | {
      catalog?: "skills";
      entries?: SkillDefinition[];
      [k: string]: unknown | undefined;
    };
export type Schema =
  | boolean
  | {
      [k: string]: unknown | undefined;
    };
export type ModelMessage = ModelMessage1 & {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: ContentBlock[];
  structuredContent?: JsonValue;
  /**
   * @minItems 1
   */
  calls?: [ProposedToolCall, ...ProposedToolCall[]];
  callId?: Id;
} & ModelMessage1 & {
    role: "system" | "developer" | "user" | "assistant" | "tool";
    content: ContentBlock[];
    structuredContent?: JsonValue;
    /**
     * @minItems 1
     */
    calls?: [ProposedToolCall, ...ProposedToolCall[]];
    callId?: Id;
  };
export type ModelMessage1 =
  | {
      content?: {
        [k: string]: unknown | undefined;
      };
      [k: string]: unknown | undefined;
    }
  | {
      [k: string]: unknown | undefined;
    }
  | {
      [k: string]: unknown | undefined;
    };
export type ModelCompletion =
  | {
      status: "succeeded";
      output?: ModelOutput;
    }
  | {
      status: "failed";
      error?: Failure;
      output?: ModelOutput;
    }
  | {
      status: "cancelled";
      reason?: Text;
      output?: ModelOutput;
    };
export type Operation =
  | {
      kind: "tool";
      call: ProposedToolCall;
    }
  | {
      kind: "resource";
      uri: Uri;
      access: "read" | "write" | "execute";
    }
  | {
      kind: "network";
      origin: Uri;
    }
  | {
      kind: "capability";
      name: NonemptyText;
    };
export type PermissionResolvedParams = {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  requestId?: Id;
  operation: Operation;
  decision: "allowed" | "denied" | "cancelled";
  optionId?: Id;
  reason?: Text;
};
export type Interaction =
  | {
      kind: "question";
      message: NonemptyText;
    }
  | {
      kind: "form";
      message: NonemptyText;
      schema: Schema;
    }
  | {
      kind: "url";
      message: NonemptyText;
      url: Uri;
    };
export type InteractionResolvedParams = {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  requestId?: Id;
  interaction: Interaction;
  response: unknown;
} & InteractionResolvedParams1;
export type InteractionResolvedParams1 =
  | {
      interaction?: {
        kind?: "question" | "form";
        [k: string]: unknown | undefined;
      };
      response?: Answer;
      [k: string]: unknown | undefined;
    }
  | {
      interaction?: {
        kind?: "url";
        [k: string]: unknown | undefined;
      };
      response?: UrlAnswer;
      [k: string]: unknown | undefined;
    };
export type Answer =
  | {
      status: "accepted";
      value: JsonValue;
    }
  | {
      status: "declined";
    }
  | {
      status: "cancelled";
    };
export type UrlAnswer =
  | {
      status: "accepted";
    }
  | {
      status: "declined";
    }
  | {
      status: "cancelled";
    };
export type AgentRef = AgentRef1 & {
  id?: Id;
  name?: NonemptyText;
};
export type AgentRef1 = {
  [k: string]: unknown | undefined;
};
export type Message = Message1 & {
  id?: Id;
  content: ContentBlock[];
  structuredContent?: JsonValue;
};
export type Message1 =
  | {
      content?: {
        [k: string]: unknown | undefined;
      };
      [k: string]: unknown | undefined;
    }
  | {
      [k: string]: unknown | undefined;
    };
export type ResourceChangedParams = {
  sessionId?: Id;
  runId?: Id;
  agentId?: Id;
  resource: ResourceRef;
  change: "created" | "modified" | "deleted" | "renamed";
  previousUri?: Uri;
};
export type MethodName = string;
export type ErrorResponse = {
  jsonrpc: "2.0";
  id: RequestId | null;
  error: RpcError;
};
export type DiscoveryAuth = {
  methods: ("token" | "oauth")[];
  oauth?: OAuthMetadata;
};

export interface RequestEnvelope {
  jsonrpc: "2.0";
  method: string;
  params: {
    [k: string]: unknown | undefined;
  };
  id: RequestId;
}
export interface NotificationEnvelope {
  jsonrpc: "2.0";
  method: string;
  params: {
    [k: string]: unknown | undefined;
  };
}
export interface SessionStartedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  reason?: Text;
  parentSessionId?: Id;
}
export interface SessionEndedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  reason?: Text;
}
export interface TextContent {
  type: "text";
  text: Text;
}
export interface ImageContent {
  type: "image";
  data: Base64;
  mimeType: MimeType;
}
export interface AudioContent {
  type: "audio";
  data: Base64;
  mimeType: MimeType;
}
export interface ResourceLinkContent {
  type: "resource_link";
  uri: Uri;
  name: NonemptyText;
  mimeType?: MimeType;
}
export interface ResourceContent {
  type: "resource";
  resource: EmbeddedResource;
}
export interface RunStartedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  input?: InputPayload;
  resumesRunId?: Id;
}
export interface RunFinishingParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  output?: Payload;
}
export interface Payload {
  content: ContentBlock[];
  structuredContent?: JsonValue;
}
export interface RunFinishedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  outcome: RunCompletion;
}
export interface Failure {
  message: NonemptyText;
  code?: NonemptyText;
}
export interface ToolRequestedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  call: ProposedToolCall;
}
export interface ProposedToolCall {
  id?: Id;
  name: NonemptyText;
  arguments: JsonValue;
}
export interface ToolStartedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  call: ObservedToolCall;
}
export interface ObservedToolCall {
  id?: Id;
  name: NonemptyText;
  arguments?: JsonValue;
}
export interface ToolFinishedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  call: ObservedToolCall;
  outcome: ToolCompletion;
}
export interface ContextCompactionRequestedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  reason?: Text;
}
export interface ContextCompactionFinishedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  outcome: Completion;
}
export interface ContextSourceLoadedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  source: Source;
  payload?: Payload;
}
export interface Source {
  kind: "skill" | "instructions" | "memory" | "resource";
  name: NonemptyText;
  uri?: Uri;
}
export interface ToolDefinition {
  name: NonemptyText;
  description?: Text;
  inputSchema: Schema;
  outputSchema?: Schema;
}
export interface SkillDefinition {
  name: NonemptyText;
  description?: Text;
  uri?: Uri;
}
export interface ModelRequestedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  model?: ModelRef;
  input?: ModelInput;
  tools?: ToolDefinition[];
  modelCallId?: Id;
}
export interface ModelRef {
  name: NonemptyText;
  provider?: NonemptyText;
}
export interface ModelInput {
  /**
   * @minItems 1
   */
  messages: [ModelMessage, ...ModelMessage[]];
  view: "complete" | "partial";
}
export interface ModelFinishedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  model?: ModelRef;
  modelCallId?: Id;
  outcome: ModelCompletion;
  usage?: Usage;
}
export interface ModelOutput {
  content: ContentBlock[];
  structuredContent?: JsonValue;
  /**
   * @minItems 1
   */
  calls?: [ProposedToolCall, ...ProposedToolCall[]];
}
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}
export interface PermissionRequestedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  requestId?: Id;
  operation: Operation;
  /**
   * @minItems 1
   */
  options: [PermissionOption, ...PermissionOption[]];
}
export interface PermissionOption {
  id: Id;
  label: NonemptyText;
  decision: "allow" | "deny";
  scope?: "once" | "session" | "persistent";
}
export interface InteractionRequestedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  requestId?: Id;
  interaction: Interaction;
}
export interface AgentRequestedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  agent: AgentRef;
  childRunId?: Id;
  input: InputPayload;
}
export interface AgentStartedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  agent: AgentRef;
  childRunId?: Id;
  input?: InputPayload;
}
export interface AgentFinishedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  agent: AgentRef;
  childRunId?: Id;
  outcome: RunCompletion;
}
export interface HandoffRequestedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  from: AgentRef;
  to: AgentRef;
  input?: InputPayload;
}
export interface HandoffFinishedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  from: AgentRef;
  to: AgentRef;
  outcome: Completion;
}
export interface MessageEmittingParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  message: Message;
  recipient?: AgentRef;
}
export interface MessageEmittedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  message: Message;
  recipient?: AgentRef;
}
export interface RunCancellationRequestedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  reason?: Text;
}
export interface RunPausedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  reason?: Text;
  interactionId?: Id;
}
export interface RunResumedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  reason?: Text;
  interactionId?: Id;
}
export interface ToolBatchFinishedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  batchId?: Id;
  /**
   * @minItems 1
   */
  calls: [ToolFinishedItem, ...ToolFinishedItem[]];
}
export interface ToolFinishedItem {
  call: ObservedToolCall;
  outcome: ToolCompletion;
}
export interface PlanUpdatedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  steps: PlanStep[];
}
export interface PlanStep {
  id?: Id;
  title: NonemptyText;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}
export interface TaskCreatedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  task: TaskSnapshot;
}
export interface TaskSnapshot {
  id: Id;
  title: NonemptyText;
  detail?: Text;
  status: "pending" | "running" | "blocked";
}
export interface TaskUpdatedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  task: TaskSnapshot;
}
export interface TaskFinishedParams {
  sessionId: Id;
  runId?: Id;
  agentId?: Id;
  task: TaskRef;
  outcome: Completion;
}
export interface TaskRef {
  id: Id;
  title?: NonemptyText;
}
export interface WorkspaceChangedParams {
  sessionId?: Id;
  runId?: Id;
  agentId?: Id;
  workspace: WorkspaceRef;
  change: "opened" | "closed" | "updated";
}
export interface WorkspaceRef {
  uri: Uri;
  name?: NonemptyText;
}
export interface ResourceRef {
  uri: Uri;
  name?: NonemptyText;
  mimeType?: MimeType;
}
export interface ConfigurationChangedParams {
  sessionId?: Id;
  runId?: Id;
  agentId?: Id;
  /**
   * @minItems 1
   */
  changes: [SettingChange, ...SettingChange[]];
}
export interface SettingChange {
  key: NonemptyText;
  value?: JsonValue;
}
export interface ModelChangedParams {
  sessionId?: Id;
  runId?: Id;
  agentId?: Id;
  model: ModelRef;
  previousModel?: ModelRef;
}
export interface NotificationCreatedParams {
  sessionId?: Id;
  runId?: Id;
  agentId?: Id;
  level: "info" | "warning" | "error";
  message: NonemptyText;
  code?: NonemptyText;
}
export interface ErrorOccurredParams {
  sessionId?: Id;
  runId?: Id;
  agentId?: Id;
  error: Failure;
  operation?: Operation;
}
export interface ClientRegisteredParams {
  client: ClientInfo;
  events: MethodName[];
}
export interface ClientInfo {
  name: NonemptyText;
  version?: NonemptyText;
  harness?: SoftwareRef;
}
export interface SoftwareRef {
  name: NonemptyText;
  version?: NonemptyText;
}
export interface ClientUpdatedParams {
  client: ClientInfo;
  events: MethodName[];
}
export interface ClientUnregisteredParams {
  client: ClientInfo;
}
export interface SuccessResponse {
  jsonrpc: "2.0";
  id: RequestId;
  result: JsonValue;
}
export interface RpcError {
  code: number;
  message: NonemptyText;
  data?: JsonValue;
}
export interface DiscoveryDocument {
  name?: NonemptyText;
  endpoint: Uri;
  auth: DiscoveryAuth;
  events: MethodName[];
  requests: MethodName[];
}
export interface OAuthMetadata {
  issuer: Uri;
  authorization_endpoint: Uri;
  token_endpoint: Uri;
  device_authorization_endpoint?: Uri;
  client_id?: NonemptyText;
  scopes_supported?: NonemptyText[];
}

export const eventDefinitions = {
  "session.started": "#/definitions/SessionStartedParams",
  "session.ended": "#/definitions/SessionEndedParams",
  "input.submitted": "#/definitions/InputSubmittedParams",
  "run.started": "#/definitions/RunStartedParams",
  "run.finishing": "#/definitions/RunFinishingParams",
  "run.finished": "#/definitions/RunFinishedParams",
  "tool.requested": "#/definitions/ToolRequestedParams",
  "tool.started": "#/definitions/ToolStartedParams",
  "tool.finished": "#/definitions/ToolFinishedParams",
  "context.compaction.requested": "#/definitions/ContextCompactionRequestedParams",
  "context.compaction.finished": "#/definitions/ContextCompactionFinishedParams",
  "context.source.loaded": "#/definitions/ContextSourceLoadedParams",
  "catalog.changed": "#/definitions/CatalogChangedParams",
  "model.requested": "#/definitions/ModelRequestedParams",
  "model.finished": "#/definitions/ModelFinishedParams",
  "permission.requested": "#/definitions/PermissionRequestedParams",
  "permission.resolved": "#/definitions/PermissionResolvedParams",
  "interaction.requested": "#/definitions/InteractionRequestedParams",
  "interaction.resolved": "#/definitions/InteractionResolvedParams",
  "agent.requested": "#/definitions/AgentRequestedParams",
  "agent.started": "#/definitions/AgentStartedParams",
  "agent.finished": "#/definitions/AgentFinishedParams",
  "handoff.requested": "#/definitions/HandoffRequestedParams",
  "handoff.finished": "#/definitions/HandoffFinishedParams",
  "message.emitting": "#/definitions/MessageEmittingParams",
  "message.emitted": "#/definitions/MessageEmittedParams",
  "run.cancellation.requested": "#/definitions/RunCancellationRequestedParams",
  "run.paused": "#/definitions/RunPausedParams",
  "run.resumed": "#/definitions/RunResumedParams",
  "tool.batch.finished": "#/definitions/ToolBatchFinishedParams",
  "plan.updated": "#/definitions/PlanUpdatedParams",
  "task.created": "#/definitions/TaskCreatedParams",
  "task.updated": "#/definitions/TaskUpdatedParams",
  "task.finished": "#/definitions/TaskFinishedParams",
  "workspace.changed": "#/definitions/WorkspaceChangedParams",
  "resource.changed": "#/definitions/ResourceChangedParams",
  "configuration.changed": "#/definitions/ConfigurationChangedParams",
  "model.changed": "#/definitions/ModelChangedParams",
  "notification.created": "#/definitions/NotificationCreatedParams",
  "error.occurred": "#/definitions/ErrorOccurredParams",
  "client.registered": "#/definitions/ClientRegisteredParams",
  "client.updated": "#/definitions/ClientUpdatedParams",
  "client.unregistered": "#/definitions/ClientUnregisteredParams"
} as const;

export type EventMethod = keyof typeof eventDefinitions;

export type EventMap = { [Event in StandardInvocation as Event["method"]]: Event["params"] };

export type EventParams<Method extends EventMethod> = EventMap[Method];
