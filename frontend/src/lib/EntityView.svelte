<script lang="ts">
  import { onMount } from "svelte";
  import { Application, Graphics, Text, TextStyle } from "pixi.js";
  import { Viewport } from "pixi-viewport";
  import { world } from "./state/world.svelte";
  import { getArchetypeColor, getArchetypeColorCSS } from "./colors";
  import { getArchetypeKey, getArchetypeDisplay } from "./utils";
  import { computeLayout, type FocusMode } from "./layout";
  import {
    WORLD_SIZE,
    BACKGROUND_COLOR,
    DETAIL_BASE_RADIUS,
    DETAIL_OVERVIEW_THRESHOLD,
    LABEL_ZOOM_THRESHOLD,
    OVERVIEW_DOT_RADIUS,
    SELECTION_RING_COLOR,
    CHANGED_RING_COLOR,
    entityRadius,
  } from "./rendering";

  type ViewLevel = "detail" | "overview" | "auto";

  let containerEl: HTMLDivElement;
  let app: Application | null = null;
  let viewport: Viewport | null = null;

  let viewLevelOverride: ViewLevel = $state("auto");
  let focusMode: FocusMode = $state("archetypes");
  let currentViewLevel: "detail" | "overview" = $state("detail");

  // Entity graphics cache
  let entityGraphics = new Map<number, Graphics>();
  let entityLabels = new Map<number, Text>();
  let lastLayoutTick = -1;
  let lastFocusMode: FocusMode | null = null;
  let cachedLayout = new Map<number, { x: number; y: number }>();

  // Tooltip state
  let tooltipText: string = $state("");
  let tooltipX: number = $state(0);
  let tooltipY: number = $state(0);
  let tooltipVisible: boolean = $state(false);

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

  function updateViewLevel() {
    if (!viewport) return;
    if (viewLevelOverride !== "auto") {
      currentViewLevel = viewLevelOverride as "detail" | "overview";
      return;
    }
    const entityPixelSize = DETAIL_BASE_RADIUS * 2 * viewport.scaled;
    currentViewLevel = entityPixelSize >= DETAIL_OVERVIEW_THRESHOLD ? "detail" : "overview";
  }

  function getLayout() {
    const tick = world.tick;
    if (tick !== lastLayoutTick || focusMode !== lastFocusMode) {
      cachedLayout = computeLayout(world.entities, focusMode);
      lastLayoutTick = tick;
      lastFocusMode = focusMode;
    }
    return cachedLayout;
  }

  function renderEntities() {
    if (!viewport || !app) return;

    const entities = world.entities;
    const layout = getLayout();
    const isDetail = currentViewLevel === "detail";
    const selectedId = world.selectedEntityId;
    const showLabels = isDetail && viewport.scaled >= LABEL_ZOOM_THRESHOLD;

    // Track which entity IDs are still present
    const activeIds = new Set<number>();

    for (const entity of entities) {
      activeIds.add(entity.id);
      const pos = layout.get(entity.id);
      if (!pos) continue;

      const color = getArchetypeColor(entity.archetype);
      const radius = isDetail ? entityRadius(entity.components.length) : OVERVIEW_DOT_RADIUS;

      // Get or create graphics
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
          const ent = world.entities.find((en) => en.id === entityId);
          const archDisplay = ent ? getArchetypeDisplay(ent.archetype) : "";
          tooltipText = `Entity ${entityId}\n${archDisplay}`;
          const global = e.global;
          tooltipX = global.x + 12;
          tooltipY = global.y - 8;
          tooltipVisible = true;
        });

        gfx.on("pointerout", () => {
          tooltipVisible = false;
        });

        viewport.addChild(gfx);
        entityGraphics.set(entity.id, gfx);
      }

      // Redraw
      gfx.clear();
      gfx.circle(0, 0, radius).fill({ color });

      // Selection ring
      if (selectedId === entity.id) {
        gfx.circle(0, 0, radius + 3).stroke({ color: SELECTION_RING_COLOR, width: 2 });
      }

      // Changed ring
      if (world.changedEntityIds.has(entity.id)) {
        gfx.circle(0, 0, radius + (selectedId === entity.id ? 6 : 3)).stroke({ color: CHANGED_RING_COLOR, width: 1.5 });
      }

      gfx.position.set(pos.x, pos.y);
      gfx.hitArea = { contains: (x: number, y: number) => x * x + y * y <= radius * radius };

      // Labels
      if (showLabels) {
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
    }

    // Remove stale graphics
    for (const [id, gfx] of entityGraphics) {
      if (!activeIds.has(id)) {
        gfx.destroy();
        entityGraphics.delete(id);
        const label = entityLabels.get(id);
        if (label) {
          label.destroy();
          entityLabels.delete(id);
        }
      }
    }
  }

  onMount(() => {
    let destroyed = false;

    let initFailed = false;

    async function init() {
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

      // Fit world in view initially
      viewport.fitWorld(true);

      // Listen for zoom changes
      viewport.on("zoomed", () => updateViewLevel());
      viewport.on("moved", () => updateViewLevel());

      updateViewLevel();
    }

    init();

    const resizeObserver = new ResizeObserver(() => {
      if (viewport && containerEl) {
        viewport.resize(containerEl.clientWidth, containerEl.clientHeight);
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
      window.removeEventListener("keydown", onKeyDown);
      resizeObserver.disconnect();
      entityGraphics.clear();
      entityLabels.clear();
      if (app && !initFailed) {
        try { app.destroy(true); } catch { /* renderer may not exist */ }
      }
      app = null;
      viewport = null;
    };
  });

  // Re-render whenever relevant state changes
  $effect(() => {
    // Read dependencies
    void world.entities;
    void world.selectedEntityId;
    void world.changedEntityIds;
    void currentViewLevel;
    void focusMode;
    void viewport;

    renderEntities();
  });
</script>

<div class="relative h-full w-full" data-testid="entity-view">
  <div bind:this={containerEl} class="h-full w-full"></div>

  <!-- View level toggle -->
  <div class="absolute right-3 top-3 flex items-center gap-1 rounded bg-bg-secondary/90 px-2 py-1 text-xs">
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

  <!-- Focus mode dropdown -->
  <div class="absolute left-3 top-3 rounded bg-bg-secondary/90 px-2 py-1 text-xs">
    <select
      class="cursor-pointer bg-transparent text-text-secondary outline-none"
      bind:value={focusMode}
    >
      <option value="archetypes">Archetypes</option>
      <option value="components">Components</option>
    </select>
  </div>

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
