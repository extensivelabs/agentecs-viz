<script lang="ts">
  import { onMount } from "svelte";
  import { Application, Circle, Graphics, Text, TextStyle } from "pixi.js";
  import { Viewport } from "pixi-viewport";
  import { world } from "./state/world.svelte";
  import { getArchetypeColor, getArchetypeColorCSS } from "./colors";
  import { getArchetypeKey, getArchetypeDisplay } from "./utils";
  import { computeLayout, PIPELINE_HEADER_Y } from "./layout";
  import type { LayoutMode, ColumnInfo, EntityPosition } from "./layout";
  import type { EntitySnapshot } from "./types";
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
    clampTooltipPosition,
    VIEWPORT_FIT_PADDING,
  } from "./rendering";

  type ViewLevel = "detail" | "overview" | "auto";

  type EntityVisualState = {
    graphics: Graphics;
    hitRadius: number;
    label: Text | null;
    badge: Text | null;
    tooltip: string;
    position: EntityPosition | null;
    radius: number;
    fillColor: number;
  };

  let containerEl: HTMLDivElement;
  let tooltipEl: HTMLDivElement | null = $state(null);
  let app: Application | null = null;
  let viewport: Viewport | null = $state(null);

  let viewLevelOverride: ViewLevel = $state("auto");
  let currentViewLevel: "detail" | "overview" = $state("detail");
  let layoutMode: LayoutMode = $state("spatial");

  let entityVisualStates = new Map<number, EntityVisualState>();
  let lastLayoutEntities: EntitySnapshot[] | null = null;
  let lastSyncedEntities: EntitySnapshot[] | null = null;
  let lastLayoutMode: LayoutMode = "spatial";
  let lastLayoutStatusFieldsKey = "";
  let cachedColumns: ColumnInfo[] = [];

  let animatingFrom: Map<number, EntityPosition> | null = null;
  let animationStart = 0;
  const ANIM_DURATION_MS = 300;
  let animFrameId = 0;
  let tooltipFrameId = 0;

  let columnHeaders: { name: string; screenX: number; screenY: number; count: number }[] = $state([]);

  let tooltipText: string = $state("");
  let tooltipX: number = $state(0);
  let tooltipY: number = $state(0);
  let tooltipVisible: boolean = $state(false);
  let tooltipMeasuredWidth = 220;
  let tooltipMeasuredHeight = 44;
  let hoveredEntityId: number | null = null;
  let tooltipAnchorX = 0;
  let tooltipAnchorY = 0;

  let filterActive = false;
  let filterMatches = new Set<number>();
  let filterEntitiesSource: EntitySnapshot[] | null = null;

  let visualSelectedEntityId: number | null = null;
  let visualChangedEntityIds = new Set<number>();
  let visualErrorEntityIds = new Set<number>();
  let visualPastErrorEntityIds = new Set<number>();
  let visualChangedEntityIdsSource: Set<number> | null = null;
  let visualErrorEntityIdsSource: Set<number> | null = null;
  let visualPastErrorEntityIdsSource: Set<number> | null = null;

  let badgeDiffCounts = new Map<number, number>();
  let previousBadgeDetail = true;

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

  function addIfPresent(target: Set<number>, value: number | null): void {
    if (value !== null) {
      target.add(value);
    }
  }

  function unionInto(target: Set<number>, source: Iterable<number>): void {
    for (const id of source) {
      target.add(id);
    }
  }

  function hasPositionedEntities(): boolean {
    for (const state of entityVisualStates.values()) {
      if (state.position) {
        return true;
      }
    }
    return false;
  }

  function fitToEntities() {
    if (!viewport) return;

    let hasEntities = false;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const state of entityVisualStates.values()) {
      if (!state.position) continue;
      hasEntities = true;
      if (state.position.x < minX) minX = state.position.x;
      if (state.position.y < minY) minY = state.position.y;
      if (state.position.x > maxX) maxX = state.position.x;
      if (state.position.y > maxY) maxY = state.position.y;
    }

    if (!hasEntities) {
      viewport.fitWorld(true);
      return;
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

  function shouldShowLabels(): boolean {
    return (
      viewport !== null
      && currentViewLevel === "detail"
      && viewport.scaled >= LABEL_ZOOM_THRESHOLD
      && animatingFrom === null
    );
  }

  function shouldShowBadges(): boolean {
    return currentViewLevel === "detail" && animatingFrom === null;
  }

  function updateTooltipMeasurements(): { width: number; height: number } {
    const width = tooltipEl?.offsetWidth ?? 0;
    const height = tooltipEl?.offsetHeight ?? 0;

    if (width > 0) tooltipMeasuredWidth = width;
    if (height > 0) tooltipMeasuredHeight = height;

    return { width, height };
  }

  function setTooltipPosition(rawX: number, rawY: number): void {
    tooltipAnchorX = rawX;
    tooltipAnchorY = rawY;

    const clamped = clampTooltipPosition(
      rawX,
      rawY,
      containerEl.clientWidth,
      containerEl.clientHeight,
      tooltipMeasuredWidth,
      tooltipMeasuredHeight,
    );

    tooltipX = clamped.x;
    tooltipY = clamped.y;
  }

  function createEntityVisualState(entityId: number): EntityVisualState {
    const graphics = new Graphics();
    graphics.eventMode = "static";
    graphics.cursor = "pointer";

    const state: EntityVisualState = {
      graphics,
      hitRadius: MIN_HIT_RADIUS,
      label: null,
      badge: null,
      tooltip: `Entity ${entityId}`,
      position: null,
      radius: OVERVIEW_DOT_RADIUS,
      fillColor: 0xffffff,
    };

    graphics.on("pointertap", () => {
      if (world.selectedEntityId === entityId) {
        world.selectEntity(null);
      } else {
        world.selectEntity(entityId);
      }
    });

    graphics.on("pointerover", (event) => {
      tooltipText = state.tooltip;
      const global = event.global;
      setTooltipPosition(global.x + 12, global.y - 8);
      tooltipVisible = true;
      hoveredEntityId = entityId;
    });

    graphics.on("pointermove", (event) => {
      if (hoveredEntityId !== entityId) return;
      const global = event.global;
      setTooltipPosition(global.x + 12, global.y - 8);
    });

    graphics.on("pointerout", () => {
      tooltipVisible = false;
      hoveredEntityId = null;
    });

    viewport?.addChild(graphics);

    return state;
  }

  function destroyEntityVisualState(entityId: number, state: EntityVisualState): void {
    if (hoveredEntityId === entityId) {
      tooltipVisible = false;
      hoveredEntityId = null;
    }

    state.graphics.destroy();
    state.label?.destroy();
    state.badge?.destroy();

    entityVisualStates.delete(entityId);
    visualChangedEntityIds.delete(entityId);
    visualErrorEntityIds.delete(entityId);
    visualPastErrorEntityIds.delete(entityId);
    filterMatches.delete(entityId);
    badgeDiffCounts.delete(entityId);
  }

  function syncEntityVisualStates(entities: EntitySnapshot[]): void {
    const activeIds = new Set<number>();

    for (const entity of entities) {
      activeIds.add(entity.id);
      if (!entityVisualStates.has(entity.id)) {
        entityVisualStates.set(entity.id, createEntityVisualState(entity.id));
      }
    }

    for (const [id, state] of entityVisualStates) {
      if (!activeIds.has(id)) {
        destroyEntityVisualState(id, state);
      }
    }

    lastSyncedEntities = entities;
  }

  function applyEntityPosition(state: EntityVisualState): void {
    if (!state.position) return;

    state.graphics.position.set(state.position.x, state.position.y);

    if (state.label) {
      state.label.position.set(state.position.x, state.position.y - state.radius - 2);
    }
    if (state.badge) {
      state.badge.position.set(state.position.x + state.radius + 6, state.position.y - state.radius - 4);
    }
  }

  function drawEntityRings(entityId: number, state: EntityVisualState): void {
    const hasSelection = visualSelectedEntityId === entityId;
    const hasChanged = visualChangedEntityIds.has(entityId);
    const hasError = visualErrorEntityIds.has(entityId);
    const hasPastError = visualPastErrorEntityIds.has(entityId);

    if (hasSelection) {
      state.graphics.circle(0, 0, state.radius + 3).stroke({ color: SELECTION_RING_COLOR, width: 2 });
    }

    if (hasChanged) {
      state.graphics.circle(0, 0, state.radius + (hasSelection ? 6 : 3)).stroke({ color: CHANGED_RING_COLOR, width: 1.5 });
    }

    if (hasError) {
      const errorOffset = hasSelection && hasChanged ? 9 : hasSelection || hasChanged ? 6 : 3;
      state.graphics.circle(0, 0, state.radius + errorOffset).stroke({ color: ERROR_RING_COLOR, width: 2 });
      return;
    }

    if (hasPastError) {
      const errorOffset = hasSelection && hasChanged ? 9 : hasSelection || hasChanged ? 6 : 3;
      state.graphics.circle(0, 0, state.radius + errorOffset).stroke({ color: 0x666666, width: 1 });
    }
  }

  function redrawEntityVisual(entityId: number): void {
    const state = entityVisualStates.get(entityId);
    if (!state) return;

    state.graphics.clear();
    state.graphics.circle(0, 0, state.radius).fill({ color: state.fillColor });
    drawEntityRings(entityId, state);
  }

  function applyEntityAlpha(entityId: number, state: EntityVisualState): void {
    const dimmed = filterActive && !filterMatches.has(entityId);
    const alpha = dimmed ? 0.15 : 1;

    state.graphics.alpha = alpha;
    if (state.label) state.label.alpha = alpha;
    if (state.badge) state.badge.alpha = alpha;
  }

  function updateEntityLabel(entityId: number, state: EntityVisualState): void {
    if (!shouldShowLabels() || !state.position) {
      if (state.label) {
        state.label.visible = false;
      }
      return;
    }

    if (!state.label) {
      state.label = new Text({
        text: `${entityId}`,
        style: new TextStyle({
          fontSize: 12,
          fill: 0xcccccc,
          fontFamily: "monospace",
        }),
      });
      state.label.anchor.set(0.5, -0.5);
      viewport?.addChild(state.label);
    }

    state.label.position.set(state.position.x, state.position.y - state.radius - 2);
    state.label.visible = true;
    state.label.alpha = state.graphics.alpha;
  }

  function updateEntityBadge(entityId: number, state: EntityVisualState): void {
    const diffCount = badgeDiffCounts.get(entityId);
    const position = state.position;
    const shouldShow = shouldShowBadges() && position !== null && typeof diffCount === "number" && diffCount > 0;

    if (!shouldShow) {
      if (state.badge) {
        state.badge.visible = false;
      }
      return;
    }

    if (!state.badge) {
      state.badge = new Text({
        text: "",
        style: new TextStyle({
          fontSize: 10,
          fill: CHANGED_RING_COLOR,
          fontFamily: "monospace",
        }),
      });
      state.badge.anchor.set(0, 1);
      viewport?.addChild(state.badge);
    }

    state.badge.text = `${diffCount}`;
    state.badge.position.set(position.x + state.radius + 6, position.y - state.radius - 4);
    state.badge.visible = true;
    state.badge.alpha = state.graphics.alpha;
  }

  function updateAllLabels(): void {
    for (const [id, state] of entityVisualStates) {
      updateEntityLabel(id, state);
    }
  }

  function updateAllBadges(): void {
    for (const [id, state] of entityVisualStates) {
      updateEntityBadge(id, state);
    }
  }

  function refreshEntityBaseVisuals(): void {
    const entities = world.entities;
    const isDetail = currentViewLevel === "detail";
    const maxR = adaptiveMaxRadius(entities.length);

    for (const entity of entities) {
      const state = entityVisualStates.get(entity.id);
      if (!state) continue;

      state.fillColor = getArchetypeColor(entity.archetype);
      state.radius = isDetail ? entityRadius(entity.components.length, maxR) : OVERVIEW_DOT_RADIUS;
      state.tooltip = `Entity ${entity.id}\n${getArchetypeDisplay(entity.archetype)}`;

      const hitRadius = Math.max(state.radius, MIN_HIT_RADIUS);
      if (state.hitRadius !== hitRadius) {
        state.hitRadius = hitRadius;
        state.graphics.hitArea = new Circle(0, 0, hitRadius);
      }

      redrawEntityVisual(entity.id);
      if (!animatingFrom) {
        applyEntityPosition(state);
        updateEntityLabel(entity.id, state);
      }
    }
  }

  function recomputeLayout() {
    if (!viewport) return;

    const entities = world.entities;
    const mode = layoutMode;
    const statusFields = getStatusFields();
    const statusFieldsKey = statusFields.join("\u0000");
    const needsRecompute = (
      entities !== lastLayoutEntities
      || mode !== lastLayoutMode
      || statusFieldsKey !== lastLayoutStatusFieldsKey
    );
    if (!needsRecompute) return;

    const prevPositions = new Map<number, EntityPosition>();
    for (const [id, state] of entityVisualStates) {
      if (state.position) {
        prevPositions.set(id, state.position);
      }
    }

    const modeChanged = mode !== lastLayoutMode && prevPositions.size > 0;
    if (entities !== lastLayoutEntities && animatingFrom) {
      cancelAnimation();
    }

    const nextLayout = computeLayout(entities, mode, statusFields);
    cachedColumns = nextLayout.columns;

    for (const state of entityVisualStates.values()) {
      state.position = null;
    }

    for (const entity of entities) {
      const state = entityVisualStates.get(entity.id);
      if (!state) continue;
      state.position = nextLayout.positions.get(entity.id) ?? null;
      if (!modeChanged && !animatingFrom) {
        applyEntityPosition(state);
      }
    }

    lastLayoutEntities = entities;
    lastLayoutMode = mode;
    lastLayoutStatusFieldsKey = statusFieldsKey;
    updateColumnHeaders();

    if (modeChanged) {
      animatingFrom = prevPositions;
      animationStart = performance.now();
      updateAllLabels();
      updateAllBadges();
      startAnimation();
      return;
    }

    animatingFrom = null;
    updateAllLabels();
    updateAllBadges();

    if (!initialFitDone && hasPositionedEntities()) {
      initialFitDone = true;
      fitToEntities();
      updateViewLevel();
    }
  }

  function startAnimation() {
    if (animFrameId) cancelAnimationFrame(animFrameId);

    function tick() {
      if (!animatingFrom) {
        animFrameId = 0;
        return;
      }

      const progress = Math.min(1, (performance.now() - animationStart) / ANIM_DURATION_MS);
      applyAnimatedPositions(progress);
      if (progress < 1) {
        animFrameId = requestAnimationFrame(tick);
      } else {
        animatingFrom = null;
        animFrameId = 0;
        for (const state of entityVisualStates.values()) {
          applyEntityPosition(state);
        }
        updateAllLabels();
        updateAllBadges();
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
    for (const [id, state] of entityVisualStates) {
      const from = animatingFrom.get(id);
      const to = state.position;
      if (!to) continue;

      if (from) {
        const x = from.x + (to.x - from.x) * progress;
        const y = from.y + (to.y - from.y) * progress;
        state.graphics.position.set(x, y);
      } else {
        state.graphics.position.set(to.x, to.y);
      }
    }
  }

  function cancelAnimation() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = 0;
    }
    animatingFrom = null;
    updateAllLabels();
    updateAllBadges();
  }

  function updateColumnHeaders() {
    if (!viewport || layoutMode !== "pipeline" || cachedColumns.length === 0) {
      columnHeaders = [];
      return;
    }

    columnHeaders = cachedColumns.map((col) => {
      const screen = viewport!.toScreen(col.x, PIPELINE_HEADER_Y);
      return { name: col.name, screenX: screen.x, screenY: screen.y, count: col.count };
    });
  }

  function setLayoutMode(mode: LayoutMode) {
    if (mode === layoutMode) return;
    layoutMode = mode;
    lastLayoutEntities = null;
  }

  onMount(() => {
    let destroyed = false;
    let initFailed = false;

    async function init() {
      entityVisualStates = new Map<number, EntityVisualState>();
      cachedColumns = [];
      lastLayoutEntities = null;
      lastSyncedEntities = null;
      lastLayoutMode = "spatial";
      lastLayoutStatusFieldsKey = "";
      initialFitDone = false;

      tooltipMeasuredWidth = 220;
      tooltipMeasuredHeight = 44;

      filterActive = false;
      filterMatches = new Set<number>();
      filterEntitiesSource = null;

      visualSelectedEntityId = null;
      visualChangedEntityIds = new Set<number>();
      visualErrorEntityIds = new Set<number>();
      visualPastErrorEntityIds = new Set<number>();
      visualChangedEntityIdsSource = null;
      visualErrorEntityIdsSource = null;
      visualPastErrorEntityIdsSource = null;

      badgeDiffCounts = new Map<number, number>();
      previousBadgeDetail = true;

      try {
        app = new Application();
        await app.init({
          background: BACKGROUND_COLOR,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
          resizeTo: containerEl,
        });
      } catch (error) {
        console.warn("[EntityView] Pixi init failed", error);
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
        .clampZoom({ minScale: 0.15, maxScale: 5 });

      app.stage.addChild(viewport);
      viewport.fitWorld(true);

      const onZoomed = () => {
        updateViewLevel();
        updateColumnHeaders();
        updateAllLabels();
        updateAllBadges();
      };

      const onMoved = () => {
        updateViewLevel();
        updateColumnHeaders();
      };

      viewport.on("zoomed", onZoomed);
      viewport.on("moved", onMoved);

      updateViewLevel();
    }

    init();

    const resizeObserver = new ResizeObserver(() => {
      if (viewport) {
        viewport.resize(containerEl.clientWidth, containerEl.clientHeight);
        updateColumnHeaders();
        if (tooltipVisible) {
          setTooltipPosition(tooltipAnchorX, tooltipAnchorY);
        }
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
      cancelAnimation();
      if (tooltipFrameId) {
        cancelAnimationFrame(tooltipFrameId);
        tooltipFrameId = 0;
      }
      window.removeEventListener("keydown", onKeyDown);
      resizeObserver.disconnect();

      for (const [id, state] of Array.from(entityVisualStates.entries())) {
        destroyEntityVisualState(id, state);
      }

      entityVisualStates = new Map<number, EntityVisualState>();
      lastSyncedEntities = null;
      filterEntitiesSource = null;
      hoveredEntityId = null;
      tooltipVisible = false;
      tooltipEl = null;
      tooltipMeasuredWidth = 220;
      tooltipMeasuredHeight = 44;

      if (app && !initFailed) {
        try {
          app.destroy(true);
        } catch (error) {
          console.warn("[EntityView] Pixi cleanup failed", error);
        }
      }

      app = null;
      viewport = null;
    };
  });

  $effect(() => {
    const entities = world.entities;
    void world.config;
    void layoutMode;
    void viewport;

    if (!viewport) return;
    if (lastSyncedEntities !== entities) {
      syncEntityVisualStates(entities);
    }

    recomputeLayout();
  });

  $effect(() => {
    const entities = world.entities;
    void currentViewLevel;
    void viewport;

    if (!viewport) return;

    refreshEntityBaseVisuals();
  });

  $effect(() => {
    const selectedEntityId = world.selectedEntityId;
    const changedEntityIds = world.changedEntityIds;
    const errorEntityIds = world.errorEntityIds;
    const pastErrorEntityIds = world.pastErrorEntityIds;

    if (!viewport) return;

    const affected = new Set<number>();

    if (selectedEntityId !== visualSelectedEntityId) {
      addIfPresent(affected, visualSelectedEntityId);
      addIfPresent(affected, selectedEntityId);
    }

    if (changedEntityIds !== visualChangedEntityIdsSource) {
      unionInto(affected, visualChangedEntityIds);
      unionInto(affected, changedEntityIds);
      visualChangedEntityIds = new Set<number>(changedEntityIds);
      visualChangedEntityIdsSource = changedEntityIds;
    }

    if (errorEntityIds !== visualErrorEntityIdsSource) {
      unionInto(affected, visualErrorEntityIds);
      unionInto(affected, errorEntityIds);
      visualErrorEntityIds = new Set<number>(errorEntityIds);
      visualErrorEntityIdsSource = errorEntityIds;
    }

    if (pastErrorEntityIds !== visualPastErrorEntityIdsSource) {
      unionInto(affected, visualPastErrorEntityIds);
      unionInto(affected, pastErrorEntityIds);
      visualPastErrorEntityIds = new Set<number>(pastErrorEntityIds);
      visualPastErrorEntityIdsSource = pastErrorEntityIds;
    }

    visualSelectedEntityId = selectedEntityId;

    for (const id of affected) {
      redrawEntityVisual(id);
    }
  });

  $effect(() => {
    const entities = world.entities;
    const hasActiveFilter = world.hasActiveFilter;
    const matchingEntityIds = world.matchingEntityIds;

    if (!viewport) return;

    const affected = new Set<number>();
    const entitiesChanged = entities !== filterEntitiesSource;

    if (
      hasActiveFilter !== filterActive
      || (entitiesChanged && (hasActiveFilter || filterActive))
    ) {
      for (const id of entityVisualStates.keys()) {
        affected.add(id);
      }
    } else {
      unionInto(affected, filterMatches);
      unionInto(affected, matchingEntityIds);
    }

    filterActive = hasActiveFilter;
    filterMatches = new Set<number>(matchingEntityIds);
    filterEntitiesSource = entities;

    for (const id of affected) {
      const state = entityVisualStates.get(id);
      if (!state) continue;
      applyEntityAlpha(id, state);
    }
  });

  $effect(() => {
    const nextDiffCounts = world.entityDiffCounts;
    const isDetail = currentViewLevel === "detail";

    if (!viewport) return;

    const affected = new Set<number>();
    if (isDetail !== previousBadgeDetail) {
      for (const id of entityVisualStates.keys()) {
        affected.add(id);
      }
    } else {
      unionInto(affected, badgeDiffCounts.keys());
      unionInto(affected, nextDiffCounts.keys());
    }

    badgeDiffCounts = new Map<number, number>(nextDiffCounts);
    previousBadgeDetail = isDetail;

    for (const id of affected) {
      const state = entityVisualStates.get(id);
      if (!state) continue;
      updateEntityBadge(id, state);
    }
  });

  $effect(() => {
    void tooltipVisible;
    void tooltipText;
    // Pointer handlers call setTooltipPosition directly while tooltip is visible.
    // This effect handles first paint and tooltip text size changes.

    if (tooltipFrameId) {
      cancelAnimationFrame(tooltipFrameId);
      tooltipFrameId = 0;
    }

    if (!tooltipVisible) return;

    tooltipFrameId = requestAnimationFrame(() => {
      if (!tooltipVisible) {
        tooltipFrameId = 0;
        return;
      }

      updateTooltipMeasurements();
      setTooltipPosition(tooltipAnchorX, tooltipAnchorY);
      tooltipFrameId = 0;
    });
  });
</script>

<div class="relative h-full w-full" data-testid="entity-view">
  <div bind:this={containerEl} class="h-full w-full"></div>

  <div class="absolute right-3 top-3 flex items-center gap-3 text-sm">
    <div class="flex items-center gap-1 rounded bg-bg-secondary/90 px-2.5 py-1.5" data-testid="layout-mode-toggle">
      {#each (["spatial", "pipeline"] as const) as mode}
        <button
          class="rounded px-2 py-0.5 capitalize"
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
    <div class="flex items-center gap-1 rounded bg-bg-secondary/90 px-2.5 py-1.5">
      {#each (["detail", "auto", "overview"] as const) as level}
        <button
          class="rounded px-2 py-0.5 capitalize"
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

  {#if layoutMode === "pipeline" && columnHeaders.length > 0}
    <div class="pointer-events-none absolute inset-0 overflow-hidden" data-testid="pipeline-columns">
      {#each columnHeaders as col (col.name)}
        <div
          class="absolute flex -translate-x-1/2 flex-col items-center"
          style:left={col.screenX + "px"}
          style:top={Math.max(4, col.screenY) + "px"}
        >
          <span class="rounded bg-bg-secondary/90 px-2.5 py-1 text-sm font-medium text-text-primary">
            {col.name}
          </span>
          <span class="mt-0.5 text-xs text-text-muted">({col.count})</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if archetypeCounts.length > 0}
    <div class="absolute bottom-3 left-3 max-h-48 overflow-y-auto rounded bg-bg-secondary/90 px-3 py-2 text-sm">
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

  <div class="absolute bottom-3 right-3 flex flex-col gap-1">
    <button
      class="flex h-8 w-8 items-center justify-center rounded bg-bg-secondary/90 text-base text-text-secondary hover:text-text-primary"
      onclick={() => viewport?.zoomPercent(0.5, true)}
      title="Zoom in"
      aria-label="Zoom in"
    >+</button>
    <button
      class="flex h-8 w-8 items-center justify-center rounded bg-bg-secondary/90 text-base text-text-secondary hover:text-text-primary"
      onclick={() => viewport?.zoomPercent(-0.33, true)}
      title="Zoom out"
      aria-label="Zoom out"
    >&minus;</button>
    <button
      class="flex h-8 w-8 items-center justify-center rounded bg-bg-secondary/90 text-base text-text-secondary hover:text-text-primary"
      onclick={() => { fitToEntities(); updateViewLevel(); }}
      title="Reset view"
      aria-label="Reset view"
    >&#8962;</button>
  </div>

  {#if tooltipVisible}
    <div
      bind:this={tooltipEl}
      class="pointer-events-none absolute z-50 whitespace-pre rounded bg-bg-secondary px-3 py-1.5 text-sm text-text-primary shadow-lg"
      style:left={tooltipX + "px"}
      style:top={tooltipY + "px"}
    >
      {tooltipText}
    </div>
  {/if}
</div>
