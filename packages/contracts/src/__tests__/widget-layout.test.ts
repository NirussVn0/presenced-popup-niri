import { describe, expect, it } from "vitest";
import { ClusterLayoutV1Schema, DEFAULT_CLUSTER_LAYOUT } from "../widget-layout.js";

describe("ClusterLayoutV1", () => {
  it("defaults to a main-only layout", () => {
    expect(DEFAULT_CLUSTER_LAYOUT).toEqual({
      version: 1,
      leftVisible: false,
      rightVisible: false,
      editMode: false,
      placements: [],
    });
  });

  it("rejects duplicate widget placements", () => {
    const duplicate = {
      ...DEFAULT_CLUSTER_LAYOUT,
      placements: [
        { widgetId: "music", side: "left", order: 0, lane: "top", size: "standard", visible: true },
        { widgetId: "music", side: "right", order: 0, lane: "top", size: "standard", visible: true },
      ],
    };
    expect(ClusterLayoutV1Schema.safeParse(duplicate).success).toBe(false);
  });
});
