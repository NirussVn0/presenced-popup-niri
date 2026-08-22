import { z } from "zod";

export const WidgetWindowIdSchema = z.enum([
  "music", "rvc", "lyrics", "system", "countdown", "pomodoro", "quote",
]);
export const WidgetSideSchema = z.enum(["left", "right"]);
export const WidgetLaneSchema = z.enum(["top", "middle", "bottom"]);
export const WidgetSizePresetSchema = z.enum(["compact", "standard", "tall", "wide"]);

export const WidgetPlacementSchema = z.object({
  widgetId: WidgetWindowIdSchema,
  side: WidgetSideSchema,
  order: z.number().int().min(0),
  lane: WidgetLaneSchema,
  size: WidgetSizePresetSchema,
  visible: z.boolean(),
});

export const ClusterLayoutV1Schema = z.object({
  version: z.literal(1),
  leftVisible: z.boolean(),
  rightVisible: z.boolean(),
  editMode: z.boolean(),
  placements: z.array(WidgetPlacementSchema),
}).superRefine((layout, ctx) => {
  const ids = new Set<string>();
  for (const placement of layout.placements) {
    if (ids.has(placement.widgetId)) {
      ctx.addIssue({ code: "custom", message: `Duplicate widget ${placement.widgetId}` });
    }
    ids.add(placement.widgetId);
  }
});

export type WidgetWindowId = z.infer<typeof WidgetWindowIdSchema>;
export type WidgetSide = z.infer<typeof WidgetSideSchema>;
export type WidgetLane = z.infer<typeof WidgetLaneSchema>;
export type WidgetSizePreset = z.infer<typeof WidgetSizePresetSchema>;
export type WidgetPlacement = z.infer<typeof WidgetPlacementSchema>;
export type ClusterLayoutV1 = z.infer<typeof ClusterLayoutV1Schema>;

export const DEFAULT_CLUSTER_LAYOUT: ClusterLayoutV1 = {
  version: 1,
  leftVisible: false,
  rightVisible: false,
  editMode: false,
  placements: [],
};
