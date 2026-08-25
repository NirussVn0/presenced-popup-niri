import { z } from "zod";
import { PresenceSnapshotSchema, ResolvedPresenceSchema } from "./presence.js";
import { IntegrationHealthSchema } from "./health.js";
import { DesktopFactSchema, MediaFactSchema } from "./facts.js";
import { ManualOverrideSchema } from "./rules.js";
import { LyricsPayloadSchema } from "./lyrics.js";
import { ClusterLayoutV1Schema } from "./widget-layout.js";
import { ThemeSettingsV1Schema } from "./theme.js";

export const DaemonEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("state.snapshot"),
    payload: PresenceSnapshotSchema,
  }),
  z.object({
    type: z.literal("presence.resolved"),
    payload: ResolvedPresenceSchema.nullable(),
  }),
  z.object({
    type: z.literal("source.health.changed"),
    payload: IntegrationHealthSchema,
  }),
  z.object({
    type: z.literal("desktop.changed"),
    payload: DesktopFactSchema.nullable(),
  }),
  z.object({
    type: z.literal("media.changed"),
    payload: MediaFactSchema.nullable(),
  }),
  z.object({
    type: z.literal("override.changed"),
    payload: ManualOverrideSchema.nullable(),
  }),
  z.object({
    type: z.literal("privacy.changed"),
    payload: z.object({ enabled: z.boolean() }),
  }),
  z.object({
    type: z.literal("lyrics.changed"),
    payload: LyricsPayloadSchema.nullable(),
  }),
  z.object({
    type: z.literal("widget.layout.changed"),
    payload: ClusterLayoutV1Schema,
  }),
  z.object({
    type: z.literal("theme.settings.changed"),
    payload: ThemeSettingsV1Schema,
  }),
]);
export type DaemonEvent = z.infer<typeof DaemonEventSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"),
  }),
  z.object({
    type: z.literal("ping"),
    id: z.string().optional(),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
