<script lang="ts">
  import { onMount } from "svelte";
  import { Application, Circle, Graphics, Text, TextStyle } from "pixi.js";
  import { Viewport } from "pixi-viewport";
  import { world } from "./state/world.svelte";
  import { getArchetypeColor, getArchetypeColorCSS } from "./colors";
  import { getArchetypeKey, getArchetypeDisplay } from "./utils";
  import { computeLayout } from "./layout";
  import type { LayoutMode, LayoutResult, ColumnInfo, EntityPosition } from "./layout";
  import {
    WORLD_SIZE,
    BACKGROUND_COLOR,
    DETAIL_BASE_RADIUS,
    DETAIL_OVERVIEW_THRESHOLD,
    LABEL_ZOOM_THRESHOLD,
    OVERVIEW_DOT_RADIUS,
    SELECTION_RING_COLOR,
    CHANGED_RING_COLOR,
    ERROR_RING_COLOR,
    MIN_HIT_RADIUS,
    entityRadius,
    adaptiveMaxRadius,
    VIEWPORT_FIT_PADDING,
  } from "./rendering";

  type ViewLevel = "detail" | "overview" | "auto";

  let containerEl: HTMLDivElement;
  let app: Application | null = null;
  let viewport: Viewport | null = $state(null);

  let viewLevelOverride: ViewLevel = $state("auto");
  let currentViewLevel: "detail" | "overview" = $state("detail");
  let layoutMode: LayoutMode = $state("spatial");

  // Entity graphics cache
  let entityGraphics = new Map<number, Graphics>();
  let entityHitRadii = new Map<number, number>();
  let entityLabels = new Map<number, Text>();
  let entityBadges = new Map<number, Text>();
  let lastLayoutTick = -1;
  let lastLayoutMode: LayoutMode = "spatial";
  let cachedLayoutResult: LayoutResult = { positions: new Map(), columns: [] };
  let cachedLayout = new Map<number, EntityPosition>();

  // Animation
  let animatingFrom: Map<number, EntityPosition> | null = null;
  let animationStart = 0;
  const ANIM_DURATION_MS = 300;
  let animFrameId = 0;

  // Column headers (screen-space, updated on viewport change)
  let columnHeaders: { name: string; screenX: number; screenY: number; count: number }[] = $state([]);

  // Entity tooltip cache
  let entityTooltips = new Map<number, string>();

  // Tooltip state
  let tooltipText: string = $state("");
  let tooltipX: number = $state(0);
  let tooltipY: number = $state(0);
  let tooltipVisible: boolean = $state(false);
  let hoveredEntityId: number | null = null;

  // Archetype legend
  let archetypeCounts: { key: string; display: string; color: string; count: number }[] = $derived.by(() => {
    const counts = new Map<string, { display: string; archetype: string[]; count: number }>();
    for (const entity of world.entities) {
      const key = getArchetypeKey(entity.archetype);
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
      } else {
        counts.set(key, {
          display: getArchetypeDisplay(entity.archetype),
          archetype: entity.archetype,
          count: 1,
        });
      }
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, { display, archetype, count }]) => ({
        key,
        display: display || "(empty)",
        color: getArchetypeColorCSS(archetype),
        count,
      }));
  });

  let initialFitDone = false;

  function fitToEntities() {
    if (!viewport) return;
    const layout = cachedLayout;
    if (layout.size === 0) {
      viewport.fitWorld(true);
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pos of layout.values()) {
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.x > maxX) maxX = pos.x;
      if (pos.y > maxY) maxY = pos.y;
    }
    const bw = maxX - minX + VIEWPORT_FIT_PADDING * 2;
    const bh = maxY - minY + VIEWPORT_FIT_PADDING * 2;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    viewport.fit(true, bw, bh);
    viewport.moveCenter(cx, cy);
  }

  function updateViewLevel() {
    if (!viewport) return;
    if (viewLevelOverride !== "auto") {
      currentViewLevel = viewLevelOverride as "detail" | "overview";
      return;
    }
    const entityPixelSize = DETAIL_BASE_RADIUS * 2 * viewport.scaled;
    currentViewLevel = entityPixelSize >= DETAIL_OVERVIEW_THRESHOLD ? "detail" : "overview";
  }

  function getStatusFields(): string[] {
    return world.config?.field_hints?.status_fields ?? ["status", "state", "phase"];
  }

  function recomputeLayout() {
    const tick = world.tick;
    const mode = layoutMode;
    const needsRecompute = tick !== lastLayoutTick || mode !== lastLayoutMode;
    if (!needsRecompute) return;

    const prevPositions = cachedLayout;
    const modeChanged = mode !== lastLayoutMode && prevPositions.size > 0;

    cachedLayoutResult = computeLayout(world.entities, mode, getStatusFields());
    cachedLayout = cachedLayoutResult.positions;
    lastLayoutTick = tick;
    lastLayoutMode = mode;

    if (modeChanged) {
      animatingFrom = new Map(prevPositions);
      animationStart = performance.now();
      startAnimation();
    }

    updateColumnHeaders();
  }

  function startAnimation() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    function tick() {
      const progress = Math.min(1, (performance.now() - animationStart) / ANIM_DURATION_MS);
      applyAnimatedPositions(progress);
      if (progress < 1) {
        animFrameId = requestAnimationFrame(tick);
      } else {
        animatingFrom = null;
        animFrameId = 0;
      }
    }
    animFrameId = requestAnimationFrame(tick);
  }

  function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  function applyAnimatedPositions(rawProgress: number) {
    if (!viewport || !animatingFrom) return;
    const progress = easeOutCubic(rawProgress);
    for (const [id, gfx] of entityGraphics) {
      const from = animatingFrom.get(id);
      const to = cachedLayout.get(id);
      if (!to) continue;
      if (from) {
        const x = from.x + (to.x - from.x) * progress;
        const y = from.y + (to.y - from.y) * progress;
        gfx.position.set(x, y);
      } else {
        gfx.position.set(to.x, to.y);
      }
      // Update label and badge positions to follow
      const label = entityLabels.get(id);
      if (label?.visible) {
        label.position.set(gfx.position.x, gfx.position.y - (entityHitRadii.get(id) ?? 12) - 2);
      }
      const badge = entityBadges.get(id);
      if (badge?.visible) {
        const r = entityHitRadii.get(id) ?? 12;
        badge.position.set(gfx.position.x + r + 6, gfx.position.y - r - 4);
      }
    }
  }

  function updateColumnHeaders() {
    if (!viewport || layoutMode !== "pipeline" || cachedLayoutResult.columns.length === 0) {
      columnHeaders = [];
      return;
    }
    columnHeaders = cachedLayoutResult.columns.map(col => {
      const screen = viewport!.toScreen(col.x, 30);
      return { name: col.name, screenX: screen.x, screenY: screen.y, count: col.count };
    });
  }

  function setLayoutMode(mode: LayoutMode) {
    if (mode === layoutMode) return;
    layoutMode = mode;
    // Force recompute on next render
    lastLayoutMode = mode === "spatial" ? "pipeline" : "spatial";
  }

  function renderEntities() {
    if (!viewport || !app) return;

    recomputeLayout();

    const entities = world.entities;
    const layout = cachedLayout;
    const isDetail = currentViewLevel === "detail";
    const selectedId = world.selectedEntityId;
    const showLabels = isDetail && viewport.scaled >= LABEL_ZOOM_THRESHOLD;
    const maxR = adaptiveMaxRadius(entities.length);

    const activeIds = new Set<number>();

    for (const entity of entities) {
      activeIds.add(entity.id);
      const pos = layout.get(entity.id);
      if (!pos) continue;

      const color = getArchetypeColor(entity.archetype);
      const radius = isDetail ? entityRadius(entity.components.length, maxR) : OVERVIEW_DOT_RADIUS;

      let gfx = entityGraphics.get(entity.id);
      if (!gfx) {
        gfx = new Graphics();
        gfx.eventMode = "static";
        gfx.cursor = "pointer";

        const entityId = entity.id;

        gfx.on("pointertap", () => {
          if (world.selectedEntityId === entityId) {
            world.selectEntity(null);
          } else {
            world.selectEntity(entityId);
          }
        });

        gfx.on("pointerover", (e) => {
          tooltipText = entityTooltips.get(entityId) ?? `Entity ${entityId}`;
          const global = e.global;
          tooltipX = global.x + 12;
          tooltipY = global.y - 8;
          tooltipVisible = true;
          hoveredEntityId = entityId;
        });

        gfx.on("pointerout", () => {
          tooltipVisible = false;
          hoveredEntityId = null;
        });

        viewport.addChild(gfx);
        entityGraphics.set(entity.id, gfx);
      }

      gfx.clear();
      gfx.circle(0, 0, radius).fill({ color });

      if (selectedId === entity.id) {
        gfx.circle(0, 0, radius + 3).stroke({ color: SELECTION_RING_COLOR, width: 2 });
      }

      if (world.changedEntityIds.has(entity.id)) {
        gfx.circle(0, 0, radius + (selectedId === entity.id ? 6 : 3)).stroke({ color: CHANGED_RING_COLOR, width: 1.5 });
      }

      if (world.errorEntityIds.has(entity.id)) {
        const hasSelection = selectedId === entity.id;
        const hasChanged = world.changedEntityIds.has(entity.id);
        const errorOffset = hasSelection && hasChanged ? 9 : hasSelection || hasChanged ? 6 : 3;
        gfx.circle(0, 0, radius + errorOffset).stroke({ color: ERROR_RING_COLOR, width: 2 });
      } else if (world.pastErrorEntityIds.has(entity.id)) {
        const hasSelection = selectedId === entity.id;
        const hasChanged = world.changedEntityIds.has(entity.id);
        const errorOffset = hasSelection && hasChanged ? 9 : hasSelection || hasChanged ? 6 : 3;
        gfx.circle(0, 0, radius + errorOffset).stroke({ color: 0x666666, width: 1 });
      }

      // Only set position directly if not animating
      if (!animatingFrom) {
        gfx.position.set(pos.x, pos.y);
      }

      entityTooltips.set(entity.id, `Entity ${entity.id}\n${getArchetypeDisplay(entity.archetype)}`);
      const hitRadius = Math.max(radius, MIN_HIT_RADIUS);
      if (entityHitRadii.get(entity.id) !== hitRadius) {
        gfx.hitArea = new Circle(0, 0, hitRadius);
        entityHitRadii.set(entity.id, hitRadius);
      }

      // Labels
      if (showLabels && !animatingFrom) {
        let label = entityLabels.get(entity.id);
        if (!label) {
          label = new Text({
            text: `${entity.id}`,
            style: new TextStyle({
              fontSize: 10,
              fill: 0xcccccc,
              fontFamily: "monospace",
            }),
          });
          label.anchor.set(0.5, -0.5);
          viewport.addChild(label);
          entityLabels.set(entity.id, label);
        }
        label.position.set(pos.x, pos.y - radius - 2);
        label.visible = true;
      } else {
        const label = entityLabels.get(entity.id);
        if (label) label.visible = false;
      }

      // Diff badges
      const diffCount = isDetail && !animatingFrom ? world.entityDiffCounts.get(entity.id) : undefined;
      if (diffCount) {
        let badge = entityBadges.get(entity.id);
        if (!badge) {
          badge = new Text({
            text: "",
            style: new TextStyle({
              fontSize: 8,
              fill: CHANGED_RING_COLOR,
              fontFamily: "monospace",
            }),
          });
          badge.anchor.set(0, 1);
          viewport.addChild(badge);
          entityBadges.set(entity.id, badge);
        }
        badge.text = `${diffCount}`;
        badge.position.set(pos.x + radius + 6, pos.y - radius - 4);
        badge.visible = true;
      } else {
        const badge = entityBadges.get(entity.id);
        if (badge) badge.visible = false;
      }
    }

    // Remove stale graphics
    for (const [id, gfx] of entityGraphics) {
      if (!activeIds.has(id)) {
        if (hoveredEntityId === id) {
          tooltipVisible = false;
          hoveredEntityId = null;
        }
        gfx.destroy();
        entityGraphics.delete(id);
        entityHitRadii.delete(id);
        entityTooltips.delete(id);
        const label = entityLabels.get(id);
        if (label) {
          label.destroy();
          entityLabels.delete(id);
        }
        const badge = entityBadges.get(id);
        if (badge) {
          badge.destroy();
          entityBadges.delete(id);
        }
      }
    }
  }

  onMount(() => {
    let destroyed = false;

    let initFailed = false;

    async function init() {
      entityGraphics = new Map();
      entityHitRadii = new Map();
      entityLabels = new Map();
      entityBadges = new Map();
      entityTooltips = new Map();
      cachedLayout = new Map();
      cachedLayoutResult = { positions: new Map(), columns: [] };
      lastLayoutTick = -1;
      lastLayoutMode = "spatial";
      initialFitDone = false;

      try {
        app = new Application();
        await app.init({
          background: BACKGROUND_COLOR,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
          resizeTo: containerEl,
        });
      } catch {
        initFailed = true;
        app = null;
        return;
      }

      if (destroyed) {
        app.destroy(true);
        app = null;
        return;
      }

      containerEl.appendChild(app.canvas);

      viewport = new Viewport({
        screenWidth: containerEl.clientWidth,
        screenHeight: containerEl.clientHeight,
        worldWidth: WORLD_SIZE,
        worldHeight: WORLD_SIZE,
        events: app.renderer.events,
      });

      viewport
        .drag()
        .pinch()
        .wheel()
        .decelerate()
        .clampZoom({ minScale: 0.1, maxScale: 4 });

      app.stage.addChild(viewport);

      viewport.fitWorld(true);

      viewport.on("zoomed", () => { updateViewLevel(); updateColumnHeaders(); });
      viewport.on("moved", () => { updateViewLevel(); updateColumnHeaders(); });

      updateViewLevel();
    }

    init();

    const resizeObserver = new ResizeObserver(() => {
      if (viewport && containerEl) {
        viewport.resize(containerEl.clientWidth, containerEl.clientHeight);
        updateColumnHeaders();
      }
    });
    resizeObserver.observe(containerEl);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        world.selectEntity(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);

    return () => {
      destroyed = true;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      window.removeEventListener("keydown", onKeyDown);
      resizeObserver.disconnect();
      entityGraphics.clear();
      entityHitRadii.clear();
      entityLabels.clear();
      entityBadges.clear();
      entityTooltips.clear();
      if (app && !initFailed) {
        try { app.destroy(true); } catch { /* renderer may not exist */ }
      }
      app = null;
      viewport = null;
    };
  });

  $effect(() => {
    void world.entities;
    void world.selectedEntityId;
    void world.changedEntityIds;
    void world.entityDiffCounts;
    void world.errorEntityIds;
    void world.pastErrorEntityIds;
    void currentViewLevel;
    void layoutMode;

    renderEntities();

    if (!initialFitDone && cachedLayout.size > 0 && viewport) {
      initialFitDone = true;
      fitToEntities();
      updateViewLevel();
    }
  });
</script>

<div class="relative h-full w-full" data-testid="entity-view">
  <div bind:this={containerEl} class="h-full w-full"></div>

  <!-- Layout mode + view level toggle -->
  <div class="absolute right-3 top-3 flex items-center gap-3 text-xs">
    <div class="flex items-center gap-1 rounded bg-bg-secondary/90 px-2 py-1" data-testid="layout-mode-toggle">
      {#each (["spatial", "pipeline"] as const) as mode}
        <button
          class="rounded px-1.5 py-0.5 capitalize"
          class:bg-accent={layoutMode === mode}
          class:text-bg-primary={layoutMode === mode}
          class:text-text-secondary={layoutMode !== mode}
          class:hover:text-text-primary={layoutMode !== mode}
          onclick={() => setLayoutMode(mode)}
          data-testid={`layout-${mode}`}
        >
          {mode}
        </button>
      {/each}
    </div>
    <div class="flex items-center gap-1 rounded bg-bg-secondary/90 px-2 py-1">
      {#each (["detail", "auto", "overview"] as const) as level}
        <button
          class="rounded px-1.5 py-0.5 capitalize"
          class:bg-accent={viewLevelOverride === level}
          class:text-bg-primary={viewLevelOverride === level}
          class:text-text-secondary={viewLevelOverride !== level}
          class:hover:text-text-primary={viewLevelOverride !== level}
          onclick={() => { viewLevelOverride = level; updateViewLevel(); }}
        >
          {level}
        </button>
      {/each}
    </div>
  </div>

  <!-- Pipeline column headers -->
  {#if layoutMode === "pipeline" && columnHeaders.length > 0}
    <div class="pointer-events-none absolute inset-0 overflow-hidden" data-testid="pipeline-columns">
      {#each columnHeaders as col (col.name)}
        <div
          class="absolute flex -translate-x-1/2 flex-col items-center"
          style:left={col.screenX + "px"}
          style:top={Math.max(4, col.screenY) + "px"}
        >
          <span class="rounded bg-bg-secondary/90 px-2 py-0.5 text-xs font-medium text-text-primary">
            {col.name}
          </span>
          <span class="mt-0.5 text-[10px] text-text-muted">({col.count})</span>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Archetype legend -->
  {#if archetypeCounts.length > 0}
    <div class="absolute bottom-3 left-3 max-h-48 overflow-y-auto rounded bg-bg-secondary/90 px-3 py-2 text-xs">
      {#each archetypeCounts as { display, color, count }}
        <div class="flex items-center gap-2 py-0.5">
          <span
            class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style:background-color={color}
          ></span>
          <span class="text-text-secondary">{display}</span>
          <span class="ml-auto text-text-muted">{count}</span>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Zoom controls -->
  <div class="absolute bottom-3 right-3 flex flex-col gap-1">
    <button
      class="flex h-7 w-7 items-center justify-center rounded bg-bg-secondary/90 text-sm text-text-secondary hover:text-text-primary"
      onclick={() => viewport?.zoomPercent(0.5, true)}
      title="Zoom in"
      aria-label="Zoom in"
    >+</button>
    <button
      class="flex h-7 w-7 items-center justify-center rounded bg-bg-secondary/90 text-sm text-text-secondary hover:text-text-primary"
      onclick={() => viewport?.zoomPercent(-0.33, true)}
      title="Zoom out"
      aria-label="Zoom out"
    >&minus;</button>
    <button
      class="flex h-7 w-7 items-center justify-center rounded bg-bg-secondary/90 text-sm text-text-secondary hover:text-text-primary"
      onclick={() => { fitToEntities(); updateViewLevel(); }}
      title="Reset view"
      aria-label="Reset view"
    >&#8962;</button>
  </div>

  <!-- Tooltip -->
  {#if tooltipVisible}
    <div
      class="pointer-events-none absolute z-50 whitespace-pre rounded bg-bg-secondary px-2 py-1 text-xs text-text-primary shadow-lg"
      style:left={tooltipX + "px"}
      style:top={tooltipY + "px"}
    >
      {tooltipText}
    </div>
  {/if}
</div>
